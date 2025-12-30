import {
  db,
  transportFlow,
  transportPosition,
  transportRoute,
  transportVessel,
} from "@trader/db";
import { and, count, eq, gte, lte } from "drizzle-orm";
import type { CommodityType, VesselType } from "../types";
import { getRegionForPosition, VESSEL_TYPE_TO_COMMODITY } from "../types";

interface FlowData {
  commodity: CommodityType;
  originRegion: string;
  destinationRegion: string;
  vesselCount: number;
  totalVolume: number;
  avgTransitTime: number;
}

export interface RegionActivity {
  region: string;
  vesselCount: number;
  vesselTypes: Record<VesselType, number>;
  totalDeadweight: number;
}

export class FlowAnalyzer {
  readonly name = "FlowAnalyzer";

  /**
   * Analyze commodity flows for a given period
   */
  async analyzeFlows(
    periodType: "daily" | "weekly" | "monthly",
    date: Date = new Date()
  ): Promise<FlowData[]> {
    const { startDate, endDate, periodLabel } = this.getPeriodBounds(
      periodType,
      date
    );

    this.log(`Analyzing flows for ${periodLabel}...`);

    // Get all completed routes in the period
    const routes = await db
      .select({
        vesselId: transportRoute.vesselId,
        originRegion: transportRoute.originRegion,
        destinationRegion: transportRoute.destinationRegion,
        commodity: transportRoute.commodity,
        estimatedVolume: transportRoute.estimatedVolume,
        departureTime: transportRoute.departureTime,
        actualArrival: transportRoute.actualArrival,
      })
      .from(transportRoute)
      .where(
        and(
          eq(transportRoute.isCompleted, true),
          gte(transportRoute.actualArrival, startDate),
          lte(transportRoute.actualArrival, endDate)
        )
      );

    // Aggregate by commodity and route
    const flowMap = new Map<string, FlowData>();

    for (const route of routes) {
      if (!(route.commodity && route.originRegion && route.destinationRegion)) {
        continue;
      }

      const key = `${route.commodity}:${route.originRegion}:${route.destinationRegion}`;
      const existing = flowMap.get(key);

      const volume = route.estimatedVolume ? Number(route.estimatedVolume) : 0;
      const transitTime =
        route.departureTime && route.actualArrival
          ? (route.actualArrival.getTime() - route.departureTime.getTime()) /
            (1000 * 60 * 60 * 24)
          : 0;

      if (existing) {
        existing.vesselCount++;
        existing.totalVolume += volume;
        existing.avgTransitTime =
          (existing.avgTransitTime * (existing.vesselCount - 1) + transitTime) /
          existing.vesselCount;
      } else {
        flowMap.set(key, {
          commodity: route.commodity,
          originRegion: route.originRegion,
          destinationRegion: route.destinationRegion,
          vesselCount: 1,
          totalVolume: volume,
          avgTransitTime: transitTime,
        });
      }
    }

    // Save flows to database
    const flows = Array.from(flowMap.values());
    await this.saveFlows(flows, periodLabel, periodType);

    this.log(`Analyzed ${flows.length} commodity flows`);
    return flows;
  }

  /**
   * Get current vessel activity by region
   */
  async getRegionActivity(hoursBack = 24): Promise<RegionActivity[]> {
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get latest positions with vessel info
    const positions = await db
      .select({
        vesselId: transportPosition.vesselId,
        latitude: transportPosition.latitude,
        longitude: transportPosition.longitude,
        vesselType: transportVessel.vesselType,
        deadweight: transportVessel.deadweight,
      })
      .from(transportPosition)
      .innerJoin(
        transportVessel,
        eq(transportPosition.vesselId, transportVessel.id)
      )
      .where(gte(transportPosition.timestamp, cutoffTime));

    // Group by region
    const regionMap = new Map<string, RegionActivity>();

    for (const pos of positions) {
      if (!(pos.latitude && pos.longitude)) continue;

      const region = getRegionForPosition(pos.latitude, pos.longitude);
      if (!region) continue;

      const existing = regionMap.get(region);
      const dwtValue = pos.deadweight ? Number(pos.deadweight) : 0;

      if (existing) {
        existing.vesselCount++;
        existing.totalDeadweight += dwtValue;
        if (pos.vesselType) {
          existing.vesselTypes[pos.vesselType] =
            (existing.vesselTypes[pos.vesselType] || 0) + 1;
        }
      } else {
        const vesselTypes: Record<VesselType, number> = {} as Record<
          VesselType,
          number
        >;
        if (pos.vesselType) {
          vesselTypes[pos.vesselType] = 1;
        }
        regionMap.set(region, {
          region,
          vesselCount: 1,
          vesselTypes,
          totalDeadweight: dwtValue,
        });
      }
    }

    return Array.from(regionMap.values()).sort(
      (a, b) => b.vesselCount - a.vesselCount
    );
  }

  /**
   * Compare current activity to historical baseline
   */
  async compareToBaseline(
    _region: string,
    vesselType: VesselType,
    baselineDays = 30
  ): Promise<{
    currentCount: number;
    baselineAvg: number;
    changePercent: number;
  }> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const baselineStart = new Date(
      now.getTime() - baselineDays * 24 * 60 * 60 * 1000
    );

    // Get current count (last 24h)
    const currentResult = await db
      .select({ count: count() })
      .from(transportPosition)
      .innerJoin(
        transportVessel,
        eq(transportPosition.vesselId, transportVessel.id)
      )
      .where(
        and(
          gte(transportPosition.timestamp, dayAgo),
          eq(transportVessel.vesselType, vesselType)
        )
      );

    const currentCount = currentResult[0]?.count || 0;

    // Get baseline average (previous N days, excluding last 24h)
    const baselineResult = await db
      .select({ count: count() })
      .from(transportPosition)
      .innerJoin(
        transportVessel,
        eq(transportPosition.vesselId, transportVessel.id)
      )
      .where(
        and(
          gte(transportPosition.timestamp, baselineStart),
          lte(transportPosition.timestamp, dayAgo),
          eq(transportVessel.vesselType, vesselType)
        )
      );

    const baselineTotal = baselineResult[0]?.count || 0;
    const baselineAvg = baselineTotal / (baselineDays - 1);

    const changePercent =
      baselineAvg > 0 ? ((currentCount - baselineAvg) / baselineAvg) * 100 : 0;

    return {
      currentCount,
      baselineAvg: Math.round(baselineAvg * 100) / 100,
      changePercent: Math.round(changePercent * 100) / 100,
    };
  }

  /**
   * Get commodity volume estimates by type
   */
  async getCommodityVolumes(
    daysBack = 7
  ): Promise<
    Record<CommodityType, { vesselCount: number; estimatedVolume: number }>
  > {
    const cutoffTime = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const vessels = await db
      .select({
        vesselType: transportVessel.vesselType,
        deadweight: transportVessel.deadweight,
      })
      .from(transportVessel)
      .innerJoin(
        transportPosition,
        eq(transportPosition.vesselId, transportVessel.id)
      )
      .where(gte(transportPosition.timestamp, cutoffTime));

    const result: Record<
      CommodityType,
      { vesselCount: number; estimatedVolume: number }
    > = {} as Record<
      CommodityType,
      { vesselCount: number; estimatedVolume: number }
    >;

    // Initialize all commodities
    const allCommodities: CommodityType[] = [
      "crude_oil",
      "brent",
      "natural_gas",
      "lng",
      "lpg",
      "wheat",
      "corn",
      "soybeans",
      "rice",
      "copper",
      "aluminum",
      "iron_ore",
      "coal",
      "container_freight",
      "other",
    ];
    for (const commodity of allCommodities) {
      result[commodity] = { vesselCount: 0, estimatedVolume: 0 };
    }

    // Count by vessel type and map to commodities
    for (const vessel of vessels) {
      if (!vessel.vesselType) continue;

      const commodities = VESSEL_TYPE_TO_COMMODITY[vessel.vesselType] || [];
      const dwt = vessel.deadweight ? Number(vessel.deadweight) : 0;

      for (const commodity of commodities) {
        result[commodity].vesselCount++;
        // Estimate volume as fraction of DWT (vessels aren't always full)
        result[commodity].estimatedVolume += dwt * 0.85;
      }
    }

    return result;
  }

  /**
   * Save flow data to database
   */
  private async saveFlows(
    flows: FlowData[],
    period: string,
    periodType: string
  ): Promise<void> {
    for (const flow of flows) {
      try {
        await db
          .insert(transportFlow)
          .values({
            commodity: flow.commodity,
            originRegion: flow.originRegion,
            destinationRegion: flow.destinationRegion,
            period,
            periodType,
            vesselCount: flow.vesselCount,
            totalVolume: String(flow.totalVolume),
            avgTransitTime: String(flow.avgTransitTime),
          })
          .onConflictDoUpdate({
            target: [
              transportFlow.commodity,
              transportFlow.originRegion,
              transportFlow.destinationRegion,
              transportFlow.period,
            ],
            set: {
              vesselCount: flow.vesselCount,
              totalVolume: String(flow.totalVolume),
              avgTransitTime: String(flow.avgTransitTime),
              updatedAt: new Date(),
            },
          });
      } catch (error) {
        this.logError(
          "Failed to save flow",
          error instanceof Error ? error : undefined
        );
      }
    }
  }

  /**
   * Get period bounds based on type
   */
  private getPeriodBounds(
    periodType: "daily" | "weekly" | "monthly",
    date: Date
  ): { startDate: Date; endDate: Date; periodLabel: string } {
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    switch (periodType) {
      case "daily": {
        const startDate = new Date(year, month, day, 0, 0, 0);
        const endDate = new Date(year, month, day, 23, 59, 59);
        const periodLabel = date.toISOString().split("T")[0] ?? "";
        return { startDate, endDate, periodLabel };
      }
      case "weekly": {
        const dayOfWeek = date.getDay();
        const startOfWeek = new Date(date);
        startOfWeek.setDate(day - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        const weekNum = Math.ceil(
          (date.getTime() - new Date(year, 0, 1).getTime()) /
            (7 * 24 * 60 * 60 * 1000)
        );
        const periodLabel = `${year}-W${String(weekNum).padStart(2, "0")}`;
        return { startDate: startOfWeek, endDate: endOfWeek, periodLabel };
      }
      case "monthly": {
        const startDate = new Date(year, month, 1, 0, 0, 0);
        const endDate = new Date(year, month + 1, 0, 23, 59, 59);
        const periodLabel = `${year}-${String(month + 1).padStart(2, "0")}`;
        return { startDate, endDate, periodLabel };
      }
    }
  }

  private log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  private logError(message: string, error?: Error): void {
    console.error(`[${this.name}] ERROR: ${message}`, error?.message || "");
  }
}

// Singleton instance
export const flowAnalyzer = new FlowAnalyzer();
