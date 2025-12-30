import type {
  AISHubResponse,
  AISHubVessel,
  Position,
  TransportCollectResult,
  VesselInfo,
} from "../types";
import { aisTypeToVesselType, REGION_BOUNDS } from "../types";
import { BaseTransportCollector } from "./base.collector";

const AISHUB_API_URL = "https://data.aishub.net/ws.php";

// Vessel types we're interested in for commodity tracking
const COMMODITY_VESSEL_TYPES = [
  "tanker_crude",
  "tanker_product",
  "tanker_chemical",
  "tanker_lng",
  "tanker_lpg",
  "bulk_carrier",
  "container",
  "ore_carrier",
];

export class AISHubCollector extends BaseTransportCollector {
  readonly name = "AISHubCollector";
  readonly source = "aishub" as const;

  private username: string;
  private format = "1"; // 1 = JSON
  private output = "json";
  private compress = "0"; // No compression

  constructor() {
    super();
    this.username = process.env.AISHUB_USERNAME || "";
    if (!this.username) {
      console.warn(
        "[AISHubCollector] AISHUB_USERNAME not set - collector will not work"
      );
    }
  }

  /**
   * Collect vessel data from AIS Hub
   */
  async collect(): Promise<TransportCollectResult> {
    const result: TransportCollectResult = {
      vesselsCollected: 0,
      aircraftCollected: 0,
      positionsRecorded: 0,
      errors: [],
    };

    if (!this.username) {
      result.errors.push("AISHUB_USERNAME not configured");
      return result;
    }

    // Collect from major shipping regions
    for (const [, region] of Object.entries(REGION_BOUNDS)) {
      try {
        this.log(`Collecting from ${region.name}...`);
        const regionResult = await this.collectRegion(
          region.minLat,
          region.minLon,
          region.maxLat,
          region.maxLon
        );
        result.vesselsCollected += regionResult.vesselsCollected;
        result.positionsRecorded += regionResult.positionsRecorded;

        // Delay between regions to respect rate limits
        await this.delay(2000);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logError(`Failed to collect from ${region.name}`, err);
        result.errors.push(`${region.name}: ${err.message}`);
      }
    }

    this.log(
      `Collection complete: ${result.vesselsCollected} vessels, ${result.positionsRecorded} positions`
    );

    return result;
  }

  /**
   * Collect vessels in a specific bounding box
   */
  async collectRegion(
    latMin: number,
    lonMin: number,
    latMax: number,
    lonMax: number
  ): Promise<{ vesselsCollected: number; positionsRecorded: number }> {
    const url = new URL(AISHUB_API_URL);
    url.searchParams.set("username", this.username);
    url.searchParams.set("format", this.format);
    url.searchParams.set("output", this.output);
    url.searchParams.set("compress", this.compress);
    url.searchParams.set("latmin", String(latMin));
    url.searchParams.set("latmax", String(latMax));
    url.searchParams.set("lonmin", String(lonMin));
    url.searchParams.set("lonmax", String(lonMax));

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`AISHub API error: ${response.status}`);
    }

    const data = (await response.json()) as AISHubResponse;

    if (data.ERROR) {
      throw new Error(data.ERROR_MESSAGE || "Unknown AISHub error");
    }

    if (!data.DATA || data.DATA.length === 0) {
      return { vesselsCollected: 0, positionsRecorded: 0 };
    }

    let vesselsCollected = 0;
    let positionsRecorded = 0;

    for (const vessel of data.DATA) {
      try {
        const vesselType = aisTypeToVesselType(vessel.TYPE);

        // Filter only commodity-relevant vessel types
        if (!COMMODITY_VESSEL_TYPES.includes(vesselType)) {
          continue;
        }

        // Calculate vessel dimensions
        const length = (vessel.A ?? 0) + (vessel.B ?? 0);
        const width = (vessel.C ?? 0) + (vessel.D ?? 0);

        // Estimate deadweight based on vessel type and size
        const deadweight = this.estimateDeadweight(vesselType, length);

        const vesselInfo: VesselInfo = {
          mmsi: vessel.MMSI,
          imo: vessel.IMO || undefined,
          name: vessel.NAME || undefined,
          callsign: vessel.CALLSIGN || undefined,
          vesselType,
          length: length > 0 ? length : undefined,
          width: width > 0 ? width : undefined,
          deadweight,
          source: this.source,
          metadata: {
            destination: vessel.DESTINATION || undefined,
            eta: vessel.ETA || undefined,
            draught: vessel.DRAUGHT || undefined,
            navStatus: vessel.NAVSTAT,
          },
        };

        const vesselId = await this.upsertVessel(vesselInfo);
        vesselsCollected++;

        // Record position
        const position: Position = {
          latitude: vessel.LATITUDE,
          longitude: vessel.LONGITUDE,
          speed: vessel.SOG || undefined,
          heading: vessel.HEADING !== 511 ? vessel.HEADING : undefined, // 511 = not available
          course: vessel.COG || undefined,
          timestamp: new Date(vessel.TIME),
        };

        await this.recordVesselPosition(vesselId, position);
        positionsRecorded++;
      } catch (error) {
        // Continue with other vessels
        this.logError(
          `Failed to process vessel ${vessel.MMSI}`,
          error instanceof Error ? error : undefined
        );
      }
    }

    return { vesselsCollected, positionsRecorded };
  }

  /**
   * Estimate deadweight tonnage based on vessel type and length
   * These are rough estimates based on typical vessel specifications
   */
  private estimateDeadweight(
    vesselType: VesselInfo["vesselType"],
    length: number
  ): number | undefined {
    if (!length || length <= 0) return undefined;

    // Very rough DWT estimates based on length
    // Real data would come from vessel databases
    const dwtPerMeter: Record<string, number> = {
      tanker_crude: 1500, // VLCC ~330m = 300k DWT
      tanker_product: 800, // Suezmax ~270m = 150k DWT
      tanker_chemical: 400, // Chemical tanker
      tanker_lng: 700, // LNG carrier
      tanker_lpg: 500, // LPG carrier
      bulk_carrier: 1000, // Capesize ~280m = 180k DWT
      container: 300, // Large container ~400m = 200k TEU
      ore_carrier: 1200, // VALEMAX ~360m = 400k DWT
      general_cargo: 200,
      ro_ro: 150,
      passenger: 50,
      fishing: 10,
      tug: 5,
      other: 100,
    };

    const multiplier = dwtPerMeter[vesselType] || 100;
    return Math.round(length * multiplier);
  }

  /**
   * Get vessels by type in a region
   */
  async getVesselsByType(
    vesselType: number,
    latMin: number,
    lonMin: number,
    latMax: number,
    lonMax: number
  ): Promise<AISHubVessel[]> {
    const url = new URL(AISHUB_API_URL);
    url.searchParams.set("username", this.username);
    url.searchParams.set("format", this.format);
    url.searchParams.set("output", this.output);
    url.searchParams.set("compress", this.compress);
    url.searchParams.set("latmin", String(latMin));
    url.searchParams.set("latmax", String(latMax));
    url.searchParams.set("lonmin", String(lonMin));
    url.searchParams.set("lonmax", String(lonMax));
    url.searchParams.set("shiptype", String(vesselType));

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`AISHub API error: ${response.status}`);
    }

    const data = (await response.json()) as AISHubResponse;

    if (data.ERROR) {
      throw new Error(data.ERROR_MESSAGE || "Unknown AISHub error");
    }

    return data.DATA || [];
  }

  /**
   * Get all tankers in the Persian Gulf region
   */
  async getPersianGulfTankers(): Promise<AISHubVessel[]> {
    const region = REGION_BOUNDS["Persian Gulf"];
    if (!region) return [];

    // AIS type 80-89 = tankers
    const tankers: AISHubVessel[] = [];
    for (let type = 80; type <= 89; type++) {
      const vessels = await this.getVesselsByType(
        type,
        region.minLat,
        region.minLon,
        region.maxLat,
        region.maxLon
      );
      tankers.push(...vessels);
      await this.delay(1000);
    }

    return tankers;
  }

  /**
   * Count vessels by type in a region
   */
  async countVesselsByRegion(
    regionName: string
  ): Promise<Record<string, number>> {
    const region = REGION_BOUNDS[regionName as keyof typeof REGION_BOUNDS];
    if (!region) {
      throw new Error(`Unknown region: ${regionName}`);
    }

    const result = await this.collectRegion(
      region.minLat,
      region.minLon,
      region.maxLat,
      region.maxLon
    );

    return {
      total: result.vesselsCollected,
    };
  }
}

// Singleton instance
export const aisHubCollector = new AISHubCollector();
