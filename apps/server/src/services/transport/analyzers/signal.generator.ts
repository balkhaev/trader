import {
  db,
  transportAircraft,
  transportPosition,
  transportSignal,
} from "@trader/db";
import { and, desc, eq, gte } from "drizzle-orm";
import type { CommodityType, VesselType } from "../types";
import { COMMODITY_TO_TICKERS } from "../types";
import { flowAnalyzer } from "./flow.analyzer";

interface SignalConfig {
  vesselType: VesselType;
  commodity: CommodityType;
  surgeThreshold: number; // % increase to trigger bullish signal
  dropThreshold: number; // % decrease to trigger bearish signal
  baselineDays: number; // Days for baseline calculation
  minVesselCount: number; // Minimum vessels for signal validity
}

const SIGNAL_CONFIGS: SignalConfig[] = [
  // Oil tankers
  {
    vesselType: "tanker_crude",
    commodity: "crude_oil",
    surgeThreshold: 20,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 10,
  },
  {
    vesselType: "tanker_crude",
    commodity: "brent",
    surgeThreshold: 20,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 10,
  },
  // LNG tankers
  {
    vesselType: "tanker_lng",
    commodity: "natural_gas",
    surgeThreshold: 25,
    dropThreshold: -20,
    baselineDays: 30,
    minVesselCount: 5,
  },
  // Bulk carriers - Grains
  {
    vesselType: "bulk_carrier",
    commodity: "wheat",
    surgeThreshold: 15,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 15,
  },
  {
    vesselType: "bulk_carrier",
    commodity: "corn",
    surgeThreshold: 15,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 15,
  },
  // Ore carriers
  {
    vesselType: "ore_carrier",
    commodity: "iron_ore",
    surgeThreshold: 20,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 8,
  },
  {
    vesselType: "ore_carrier",
    commodity: "copper",
    surgeThreshold: 20,
    dropThreshold: -15,
    baselineDays: 30,
    minVesselCount: 5,
  },
  // Containers - Supply chain indicator
  {
    vesselType: "container",
    commodity: "container_freight",
    surgeThreshold: 10,
    dropThreshold: -10,
    baselineDays: 30,
    minVesselCount: 20,
  },
];

interface GeneratedSignal {
  signalType: string;
  commodity: CommodityType;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  confidence: number;
  description: string;
  triggerValue: number;
  baselineValue: number;
  changePercent: number;
  affectedTickers: string[];
  metadata: Record<string, unknown>;
}

export class SignalGenerator {
  readonly name = "SignalGenerator";

  /**
   * Generate all signals based on current transport data
   */
  async generateSignals(): Promise<GeneratedSignal[]> {
    this.log("Generating transport signals...");

    const signals: GeneratedSignal[] = [];

    // Generate vessel flow signals
    const flowSignals = await this.generateVesselFlowSignals();
    signals.push(...flowSignals);

    // Generate port congestion signals
    const congestionSignals = await this.generateCongestionSignals();
    signals.push(...congestionSignals);

    // Generate private jet cluster signals (M&A indicator)
    const jetSignals = await this.generatePrivateJetSignals();
    signals.push(...jetSignals);

    // Save signals to database
    for (const signal of signals) {
      await this.saveSignal(signal);
    }

    this.log(`Generated ${signals.length} signals`);
    return signals;
  }

  /**
   * Generate signals based on vessel flow changes
   */
  private async generateVesselFlowSignals(): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];

    for (const config of SIGNAL_CONFIGS) {
      try {
        const comparison = await flowAnalyzer.compareToBaseline(
          "", // All regions
          config.vesselType,
          config.baselineDays
        );

        // Skip if not enough vessels
        if (comparison.currentCount < config.minVesselCount) {
          continue;
        }

        const changePercent = comparison.changePercent;
        const tickers = COMMODITY_TO_TICKERS[config.commodity] || [];

        // Check for surge signal
        if (changePercent >= config.surgeThreshold) {
          const strength = Math.min(100, 50 + changePercent);
          const confidence = Math.min(
            0.95,
            0.6 + (comparison.currentCount / 100) * 0.3
          );

          signals.push({
            signalType: this.getSignalType(config.vesselType, true),
            commodity: config.commodity,
            direction: "bullish",
            strength,
            confidence,
            description: `${config.vesselType} traffic up ${changePercent.toFixed(1)}% vs ${config.baselineDays}-day avg. Indicates increased ${config.commodity} supply/demand.`,
            triggerValue: comparison.currentCount,
            baselineValue: comparison.baselineAvg,
            changePercent,
            affectedTickers: tickers,
            metadata: {
              vesselType: config.vesselType,
              baselineDays: config.baselineDays,
              vesselCount: comparison.currentCount,
            },
          });
        }

        // Check for drop signal
        if (changePercent <= config.dropThreshold) {
          const strength = Math.min(100, 50 + Math.abs(changePercent));
          const confidence = Math.min(
            0.95,
            0.6 + (comparison.currentCount / 100) * 0.3
          );

          signals.push({
            signalType: this.getSignalType(config.vesselType, false),
            commodity: config.commodity,
            direction: "bearish",
            strength,
            confidence,
            description: `${config.vesselType} traffic down ${Math.abs(changePercent).toFixed(1)}% vs ${config.baselineDays}-day avg. Potential supply disruption for ${config.commodity}.`,
            triggerValue: comparison.currentCount,
            baselineValue: comparison.baselineAvg,
            changePercent,
            affectedTickers: tickers,
            metadata: {
              vesselType: config.vesselType,
              baselineDays: config.baselineDays,
              vesselCount: comparison.currentCount,
            },
          });
        }
      } catch (error) {
        this.logError(
          `Failed to analyze ${config.vesselType}`,
          error instanceof Error ? error : undefined
        );
      }
    }

    return signals;
  }

  /**
   * Generate signals based on port congestion patterns
   * TODO: Implement when port call data is available
   */
  private async generateCongestionSignals(): Promise<GeneratedSignal[]> {
    // This would analyze waiting times at major ports
    // For now, return empty - requires port call data
    return [];
  }

  /**
   * Generate signals based on private jet clustering
   * (Indicator of M&A activity when executives gather)
   */
  private async generatePrivateJetSignals(): Promise<GeneratedSignal[]> {
    const signals: GeneratedSignal[] = [];
    const hoursBack = 6;
    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get recent private jet positions
    const positions = await db
      .select({
        latitude: transportPosition.latitude,
        longitude: transportPosition.longitude,
        callsign: transportAircraft.callsign,
      })
      .from(transportPosition)
      .innerJoin(
        transportAircraft,
        eq(transportPosition.aircraftId, transportAircraft.id)
      )
      .where(
        and(
          eq(transportAircraft.aircraftType, "private_jet"),
          gte(transportPosition.timestamp, cutoffTime)
        )
      );

    if (positions.length < 3) {
      return signals;
    }

    // Simple clustering: group jets within ~50km radius
    const clusters = this.findClusters(
      positions.map((p) => ({
        lat: p.latitude,
        lon: p.longitude,
        id: p.callsign || "",
      })),
      50 // 50km radius
    );

    // Report clusters with 3+ jets
    for (const cluster of clusters) {
      if (cluster.count >= 3) {
        const location = this.describeLocation(
          cluster.centerLat,
          cluster.centerLon
        );

        signals.push({
          signalType: "private_jet_cluster",
          commodity: "other",
          direction: "neutral",
          strength: 30 + cluster.count * 10,
          confidence: 0.4 + cluster.count * 0.1,
          description: `${cluster.count} private jets clustered near ${location}. Possible executive meeting or M&A activity.`,
          triggerValue: cluster.count,
          baselineValue: 1,
          changePercent: (cluster.count - 1) * 100,
          affectedTickers: [],
          metadata: {
            location,
            centerLat: cluster.centerLat,
            centerLon: cluster.centerLon,
            jetCount: cluster.count,
            hoursBack,
          },
        });
      }
    }

    return signals;
  }

  /**
   * Simple clustering algorithm for positions
   */
  private findClusters(
    points: Array<{ lat: number; lon: number; id: string }>,
    radiusKm: number
  ): Array<{
    centerLat: number;
    centerLon: number;
    count: number;
    ids: string[];
  }> {
    const clusters: Array<{
      centerLat: number;
      centerLon: number;
      count: number;
      ids: string[];
    }> = [];
    const used = new Set<number>();

    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;

      const pointI = points[i];
      if (!pointI) continue;

      const clusterPoints: Array<{ id: string; lat: number; lon: number }> = [
        pointI,
      ];
      used.add(i);

      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;

        const pointJ = points[j];
        if (!pointJ) continue;

        const dist = this.haversineDistance(
          pointI.lat,
          pointI.lon,
          pointJ.lat,
          pointJ.lon
        );

        if (dist <= radiusKm) {
          clusterPoints.push(pointJ);
          used.add(j);
        }
      }

      if (clusterPoints.length >= 2) {
        let latSum = 0;
        let lonSum = 0;
        const ids: string[] = [];
        for (const pt of clusterPoints) {
          latSum += pt.lat;
          lonSum += pt.lon;
          ids.push(pt.id);
        }
        const centerLat = latSum / clusterPoints.length;
        const centerLon = lonSum / clusterPoints.length;

        clusters.push({
          centerLat,
          centerLon,
          count: clusterPoints.length,
          ids,
        });
      }
    }

    return clusters;
  }

  /**
   * Haversine formula for distance between two points
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Describe a location by coordinates
   */
  private describeLocation(lat: number, lon: number): string {
    // Major cities/regions for common coordinates
    const locations = [
      { name: "New York", lat: 40.7, lon: -74.0 },
      { name: "San Francisco", lat: 37.8, lon: -122.4 },
      { name: "London", lat: 51.5, lon: -0.1 },
      { name: "Dubai", lat: 25.2, lon: 55.3 },
      { name: "Singapore", lat: 1.4, lon: 103.8 },
      { name: "Hong Kong", lat: 22.3, lon: 114.2 },
      { name: "Zurich", lat: 47.4, lon: 8.5 },
      { name: "Davos", lat: 46.8, lon: 9.8 },
      { name: "Jackson Hole", lat: 43.5, lon: -110.8 },
      { name: "Aspen", lat: 39.2, lon: -106.8 },
    ];

    let nearest = "Unknown location";
    let nearestDist = Number.POSITIVE_INFINITY;

    for (const loc of locations) {
      const dist = this.haversineDistance(lat, lon, loc.lat, loc.lon);
      if (dist < nearestDist && dist < 200) {
        nearestDist = dist;
        nearest = loc.name;
      }
    }

    return nearest;
  }

  /**
   * Get signal type based on vessel type and direction
   */
  private getSignalType(vesselType: VesselType, isSurge: boolean): string {
    const typeMap: Record<string, { surge: string; drop: string }> = {
      tanker_crude: { surge: "tanker_surge", drop: "tanker_decline" },
      tanker_product: { surge: "tanker_surge", drop: "tanker_decline" },
      tanker_lng: { surge: "tanker_surge", drop: "tanker_decline" },
      tanker_lpg: { surge: "tanker_surge", drop: "tanker_decline" },
      bulk_carrier: { surge: "bulk_flow_increase", drop: "bulk_flow_drop" },
      container: { surge: "cargo_surge", drop: "supply_disruption" },
      ore_carrier: { surge: "bulk_flow_increase", drop: "bulk_flow_drop" },
    };

    const mapping = typeMap[vesselType];
    if (mapping) {
      return isSurge ? mapping.surge : mapping.drop;
    }
    return isSurge ? "cargo_surge" : "supply_disruption";
  }

  /**
   * Save signal to database
   */
  private async saveSignal(signal: GeneratedSignal): Promise<void> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.insert(transportSignal).values({
      signalType: signal.signalType as
        | "tanker_surge"
        | "tanker_decline"
        | "bulk_flow_increase"
        | "bulk_flow_drop"
        | "port_congestion"
        | "port_clearing"
        | "route_change"
        | "private_jet_cluster"
        | "cargo_surge"
        | "supply_disruption",
      commodity: signal.commodity,
      direction: signal.direction,
      strength: String(signal.strength),
      confidence: String(signal.confidence),
      description: signal.description,
      triggerValue: String(signal.triggerValue),
      baselineValue: String(signal.baselineValue),
      changePercent: String(signal.changePercent),
      affectedTickers: signal.affectedTickers,
      metadata: signal.metadata,
      expiresAt,
    });
  }

  /**
   * Get active signals
   */
  async getActiveSignals(): Promise<
    Array<{
      id: string;
      signalType: string;
      commodity: string | null;
      direction: string;
      strength: string;
      confidence: string;
      description: string;
      affectedTickers: string[] | null;
      createdAt: Date;
    }>
  > {
    return await db
      .select({
        id: transportSignal.id,
        signalType: transportSignal.signalType,
        commodity: transportSignal.commodity,
        direction: transportSignal.direction,
        strength: transportSignal.strength,
        confidence: transportSignal.confidence,
        description: transportSignal.description,
        affectedTickers: transportSignal.affectedTickers,
        createdAt: transportSignal.createdAt,
      })
      .from(transportSignal)
      .where(eq(transportSignal.isActive, true))
      .orderBy(desc(transportSignal.createdAt))
      .limit(50);
  }

  private log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }

  private logError(message: string, error?: Error): void {
    console.error(`[${this.name}] ERROR: ${message}`, error?.message || "");
  }
}

// Singleton instance
export const signalGenerator = new SignalGenerator();
