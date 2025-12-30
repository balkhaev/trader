import {
  db,
  transportAircraft,
  transportFlow,
  transportPosition,
  transportSignal,
  transportVessel,
} from "@trader/db";
import { and, count, desc, eq } from "drizzle-orm";
import { flowAnalyzer } from "./analyzers/flow.analyzer";
import { signalGenerator } from "./analyzers/signal.generator";
import { aisHubCollector } from "./collectors/aishub.collector";
import { openSkyCollector } from "./collectors/opensky.collector";
import type { TransportCollectResult } from "./types";

interface CollectionStats {
  lastAircraftCollection: Date | null;
  lastVesselCollection: Date | null;
  totalVessels: number;
  totalAircraft: number;
  totalPositions: number;
  totalSignals: number;
}

export class TransportService {
  readonly name = "TransportService";

  private isCollecting = false;
  private lastAircraftCollection: Date | null = null;
  private lastVesselCollection: Date | null = null;

  /**
   * Collect data from all sources
   */
  async collectAll(): Promise<TransportCollectResult> {
    if (this.isCollecting) {
      throw new Error("Collection already in progress");
    }

    this.isCollecting = true;
    const result: TransportCollectResult = {
      vesselsCollected: 0,
      aircraftCollected: 0,
      positionsRecorded: 0,
      errors: [],
    };

    try {
      // Collect aircraft data
      this.log("Collecting aircraft data...");
      const aircraftResult = await openSkyCollector.collect();
      result.aircraftCollected = aircraftResult.aircraftCollected;
      result.positionsRecorded += aircraftResult.positionsRecorded;
      result.errors.push(...aircraftResult.errors);
      this.lastAircraftCollection = new Date();

      // Collect vessel data
      this.log("Collecting vessel data...");
      const vesselResult = await aisHubCollector.collect();
      result.vesselsCollected = vesselResult.vesselsCollected;
      result.positionsRecorded += vesselResult.positionsRecorded;
      result.errors.push(...vesselResult.errors);
      this.lastVesselCollection = new Date();

      this.log(
        `Collection complete: ${result.vesselsCollected} vessels, ${result.aircraftCollected} aircraft, ${result.positionsRecorded} positions`
      );
    } finally {
      this.isCollecting = false;
    }

    return result;
  }

  /**
   * Collect only aircraft data
   */
  async collectAircraft(): Promise<TransportCollectResult> {
    const result = await openSkyCollector.collect();
    this.lastAircraftCollection = new Date();
    return result;
  }

  /**
   * Collect only vessel data
   */
  async collectVessels(): Promise<TransportCollectResult> {
    const result = await aisHubCollector.collect();
    this.lastVesselCollection = new Date();
    return result;
  }

  /**
   * Analyze flows and generate signals
   */
  async analyzeAndGenerateSignals(): Promise<{
    flowsAnalyzed: number;
    signalsGenerated: number;
  }> {
    // Analyze daily flows
    const flows = await flowAnalyzer.analyzeFlows("daily");

    // Generate signals
    const signals = await signalGenerator.generateSignals();

    return {
      flowsAnalyzed: flows.length,
      signalsGenerated: signals.length,
    };
  }

  /**
   * Get collection statistics
   */
  async getStats(): Promise<CollectionStats> {
    const [vesselCountResult] = await db
      .select({ count: count() })
      .from(transportVessel);

    const [aircraftCountResult] = await db
      .select({ count: count() })
      .from(transportAircraft);

    const [positionCountResult] = await db
      .select({ count: count() })
      .from(transportPosition);

    const [signalCountResult] = await db
      .select({ count: count() })
      .from(transportSignal)
      .where(eq(transportSignal.isActive, true));

    return {
      lastAircraftCollection: this.lastAircraftCollection,
      lastVesselCollection: this.lastVesselCollection,
      totalVessels: vesselCountResult?.count || 0,
      totalAircraft: aircraftCountResult?.count || 0,
      totalPositions: positionCountResult?.count || 0,
      totalSignals: signalCountResult?.count || 0,
    };
  }

  /**
   * Get vessels list with optional filters
   */
  async getVessels(
    options: { vesselType?: string; limit?: number; offset?: number } = {}
  ): Promise<
    Array<{
      id: string;
      mmsi: string;
      name: string | null;
      vesselType: string;
      flag: string | null;
      deadweight: string | null;
      createdAt: Date;
    }>
  > {
    const { vesselType, limit = 50, offset = 0 } = options;

    let query = db
      .select({
        id: transportVessel.id,
        mmsi: transportVessel.mmsi,
        name: transportVessel.name,
        vesselType: transportVessel.vesselType,
        flag: transportVessel.flag,
        deadweight: transportVessel.deadweight,
        createdAt: transportVessel.createdAt,
      })
      .from(transportVessel)
      .where(eq(transportVessel.isActive, true))
      .orderBy(desc(transportVessel.updatedAt))
      .limit(limit)
      .offset(offset);

    if (vesselType) {
      query = db
        .select({
          id: transportVessel.id,
          mmsi: transportVessel.mmsi,
          name: transportVessel.name,
          vesselType: transportVessel.vesselType,
          flag: transportVessel.flag,
          deadweight: transportVessel.deadweight,
          createdAt: transportVessel.createdAt,
        })
        .from(transportVessel)
        .where(
          and(
            eq(transportVessel.isActive, true),
            eq(
              transportVessel.vesselType,
              vesselType as
                | "tanker_crude"
                | "tanker_product"
                | "tanker_chemical"
                | "tanker_lng"
                | "tanker_lpg"
                | "bulk_carrier"
                | "container"
                | "general_cargo"
                | "ore_carrier"
                | "ro_ro"
                | "passenger"
                | "fishing"
                | "tug"
                | "other"
            )
          )
        )
        .orderBy(desc(transportVessel.updatedAt))
        .limit(limit)
        .offset(offset);
    }

    return await query;
  }

  /**
   * Get aircraft list with optional filters
   */
  async getAircraft(
    options: { aircraftType?: string; limit?: number; offset?: number } = {}
  ): Promise<
    Array<{
      id: string;
      icao24: string;
      callsign: string | null;
      aircraftType: string;
      operator: string | null;
      country: string | null;
      createdAt: Date;
    }>
  > {
    const { aircraftType, limit = 50, offset = 0 } = options;

    let query = db
      .select({
        id: transportAircraft.id,
        icao24: transportAircraft.icao24,
        callsign: transportAircraft.callsign,
        aircraftType: transportAircraft.aircraftType,
        operator: transportAircraft.operator,
        country: transportAircraft.country,
        createdAt: transportAircraft.createdAt,
      })
      .from(transportAircraft)
      .where(eq(transportAircraft.isActive, true))
      .orderBy(desc(transportAircraft.updatedAt))
      .limit(limit)
      .offset(offset);

    if (aircraftType) {
      query = db
        .select({
          id: transportAircraft.id,
          icao24: transportAircraft.icao24,
          callsign: transportAircraft.callsign,
          aircraftType: transportAircraft.aircraftType,
          operator: transportAircraft.operator,
          country: transportAircraft.country,
          createdAt: transportAircraft.createdAt,
        })
        .from(transportAircraft)
        .where(
          and(
            eq(transportAircraft.isActive, true),
            eq(
              transportAircraft.aircraftType,
              aircraftType as
                | "cargo"
                | "passenger"
                | "private_jet"
                | "helicopter"
                | "military"
                | "other"
            )
          )
        )
        .orderBy(desc(transportAircraft.updatedAt))
        .limit(limit)
        .offset(offset);
    }

    return await query;
  }

  /**
   * Get commodity flows
   */
  async getFlows(
    options: { commodity?: string; periodType?: string; limit?: number } = {}
  ): Promise<
    Array<{
      id: string;
      commodity: string;
      originRegion: string;
      destinationRegion: string;
      period: string;
      vesselCount: number;
      totalVolume: string;
      volumeChange: string | null;
      createdAt: Date;
    }>
  > {
    const { commodity, periodType, limit = 50 } = options;

    const conditions = [];
    if (commodity) {
      conditions.push(
        eq(
          transportFlow.commodity,
          commodity as
            | "crude_oil"
            | "brent"
            | "natural_gas"
            | "lng"
            | "lpg"
            | "wheat"
            | "corn"
            | "soybeans"
            | "rice"
            | "copper"
            | "aluminum"
            | "iron_ore"
            | "coal"
            | "container_freight"
            | "other"
        )
      );
    }
    if (periodType) {
      conditions.push(eq(transportFlow.periodType, periodType));
    }

    return await db
      .select({
        id: transportFlow.id,
        commodity: transportFlow.commodity,
        originRegion: transportFlow.originRegion,
        destinationRegion: transportFlow.destinationRegion,
        period: transportFlow.period,
        vesselCount: transportFlow.vesselCount,
        totalVolume: transportFlow.totalVolume,
        volumeChange: transportFlow.volumeChange,
        createdAt: transportFlow.createdAt,
      })
      .from(transportFlow)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transportFlow.period))
      .limit(limit);
  }

  /**
   * Get active signals
   */
  async getSignals(
    options: { commodity?: string; direction?: string; limit?: number } = {}
  ): Promise<
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
    const { commodity, direction, limit = 50 } = options;

    const conditions = [eq(transportSignal.isActive, true)];
    if (commodity) {
      conditions.push(
        eq(
          transportSignal.commodity,
          commodity as
            | "crude_oil"
            | "brent"
            | "natural_gas"
            | "lng"
            | "lpg"
            | "wheat"
            | "corn"
            | "soybeans"
            | "rice"
            | "copper"
            | "aluminum"
            | "iron_ore"
            | "coal"
            | "container_freight"
            | "other"
        )
      );
    }
    if (direction) {
      conditions.push(
        eq(
          transportSignal.direction,
          direction as "bullish" | "bearish" | "neutral"
        )
      );
    }

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
      .where(and(...conditions))
      .orderBy(desc(transportSignal.createdAt))
      .limit(limit);
  }

  /**
   * Get region activity summary
   */
  async getRegionActivity(hoursBack = 24) {
    return await flowAnalyzer.getRegionActivity(hoursBack);
  }

  /**
   * Get commodity volumes
   */
  async getCommodityVolumes(daysBack = 7) {
    return await flowAnalyzer.getCommodityVolumes(daysBack);
  }

  private log(message: string): void {
    console.log(`[${this.name}] ${message}`);
  }
}

// Singleton instance
export const transportService = new TransportService();
