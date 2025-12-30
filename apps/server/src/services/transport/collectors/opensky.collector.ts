import type {
  AircraftInfo,
  OpenSkyResponse,
  Position,
  TransportCollectResult,
} from "../types";
import { openSkyCategoryToAircraftType } from "../types";
import { BaseTransportCollector } from "./base.collector";

const OPENSKY_API_URL = "https://opensky-network.org/api";

// Bounding boxes for cargo-heavy regions
const CARGO_REGIONS = [
  // Memphis - FedEx hub
  { name: "Memphis", lamin: 34.8, lomin: -90.5, lamax: 35.5, lomax: -89.5 },
  // Louisville - UPS hub
  { name: "Louisville", lamin: 38.0, lomin: -86.0, lamax: 38.5, lomax: -85.5 },
  // Anchorage - cargo stopover
  { name: "Anchorage", lamin: 61.0, lomin: -150.5, lamax: 61.5, lomax: -149.5 },
  // Frankfurt - European cargo hub
  { name: "Frankfurt", lamin: 49.8, lomin: 8.3, lamax: 50.3, lomax: 9.0 },
  // Hong Kong
  { name: "Hong Kong", lamin: 22.0, lomin: 113.5, lamax: 22.8, lomax: 114.5 },
  // Dubai
  { name: "Dubai", lamin: 24.8, lomin: 54.8, lamax: 25.5, lomax: 55.8 },
  // Singapore
  { name: "Singapore", lamin: 1.0, lomin: 103.5, lamax: 1.6, lomax: 104.2 },
  // Shanghai
  { name: "Shanghai", lamin: 30.8, lomin: 121.0, lamax: 31.6, lomax: 122.0 },
];

// Known cargo airlines ICAO prefixes
const CARGO_AIRLINE_PREFIXES = [
  "FDX", // FedEx
  "UPS", // UPS
  "GTI", // Atlas Air
  "ABW", // AirBridgeCargo
  "CLX", // Cargolux
  "KZR", // Air Astana Cargo
  "CAL", // China Airlines Cargo
  "CKS", // Kalitta Air
  "MAS", // MASkargo
  "SIA", // Singapore Airlines Cargo
  "CPA", // Cathay Pacific Cargo
  "UAE", // Emirates SkyCargo
  "DHL", // DHL
  "QTR", // Qatar Cargo
  "ETH", // Ethiopian Cargo
];

// Private jet patterns (typically N-numbers starting with N, 2-REG, etc.)
const PRIVATE_JET_PATTERNS = [
  /^N\d{1,5}[A-Z]{0,2}$/, // US N-numbers
  /^2-[A-Z]{4}$/, // Channel Islands
  /^VP-[BC][A-Z]{2}$/, // British Overseas
  /^M-[A-Z]{4}$/, // Isle of Man
  /^OE-[A-Z]{3}$/, // Austria (many bizjets)
];

export class OpenSkyCollector extends BaseTransportCollector {
  readonly name = "OpenSkyCollector";
  readonly source = "opensky" as const;

  private username?: string;
  private password?: string;

  constructor() {
    super();
    // OpenSky credentials from env (optional, increases rate limit)
    this.username = process.env.OPENSKY_USERNAME;
    this.password = process.env.OPENSKY_PASSWORD;
  }

  /**
   * Collect aircraft data from OpenSky Network
   */
  async collect(): Promise<TransportCollectResult> {
    const result: TransportCollectResult = {
      vesselsCollected: 0,
      aircraftCollected: 0,
      positionsRecorded: 0,
      errors: [],
    };

    // Collect from cargo hub regions
    for (const region of CARGO_REGIONS) {
      try {
        this.log(`Collecting from ${region.name}...`);
        const regionResult = await this.collectRegion(
          region.lamin,
          region.lomin,
          region.lamax,
          region.lomax
        );
        result.aircraftCollected += regionResult.aircraftCollected;
        result.positionsRecorded += regionResult.positionsRecorded;

        // Delay between regions to respect rate limits
        await this.delay(1000);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logError(`Failed to collect from ${region.name}`, err);
        result.errors.push(`${region.name}: ${err.message}`);
      }
    }

    this.log(
      `Collection complete: ${result.aircraftCollected} aircraft, ${result.positionsRecorded} positions`
    );

    return result;
  }

  /**
   * Collect aircraft in a specific region
   */
  async collectRegion(
    lamin: number,
    lomin: number,
    lamax: number,
    lomax: number
  ): Promise<{ aircraftCollected: number; positionsRecorded: number }> {
    const url = new URL(`${OPENSKY_API_URL}/states/all`);
    url.searchParams.set("lamin", String(lamin));
    url.searchParams.set("lomin", String(lomin));
    url.searchParams.set("lamax", String(lamax));
    url.searchParams.set("lomax", String(lomax));

    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString(
        "base64"
      );
      headers.Authorization = `Basic ${auth}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Rate limit exceeded");
      }
      throw new Error(`OpenSky API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenSkyResponse;

    if (!data.states || data.states.length === 0) {
      return { aircraftCollected: 0, positionsRecorded: 0 };
    }

    let aircraftCollected = 0;
    let positionsRecorded = 0;

    for (const state of data.states) {
      try {
        const [
          icao24,
          callsign,
          originCountry,
          timePosition,
          lastContact,
          longitude,
          latitude,
          baroAltitude,
          onGround,
          velocity,
          trueTrack,
          ,
          ,
          geoAltitude,
          squawk,
          ,
          category,
        ] = state;

        // Skip if no position data
        if (latitude === null || longitude === null) continue;

        // Determine aircraft type
        const aircraftType = this.determineAircraftType(
          callsign?.trim() || null,
          category ?? 0
        );

        // Create/update aircraft
        const aircraftInfo: AircraftInfo = {
          icao24,
          callsign: callsign?.trim() || undefined,
          aircraftType,
          country: originCountry,
          source: this.source,
          metadata: {
            category,
            onGround,
            squawk: squawk || undefined,
          },
        };

        const aircraftId = await this.upsertAircraft(aircraftInfo);
        aircraftCollected++;

        // Record position
        const position: Position = {
          latitude,
          longitude,
          altitude: geoAltitude || baroAltitude || undefined,
          speed: velocity || undefined,
          heading: trueTrack || undefined,
          timestamp: new Date((timePosition || lastContact) * 1000),
        };

        await this.recordAircraftPosition(aircraftId, position);
        positionsRecorded++;
      } catch (error) {
        // Continue with other aircraft
        this.logError(
          "Failed to process aircraft",
          error instanceof Error ? error : undefined
        );
      }
    }

    return { aircraftCollected, positionsRecorded };
  }

  /**
   * Determine aircraft type from callsign and category
   */
  private determineAircraftType(
    callsign: string | null,
    category: number
  ): AircraftInfo["aircraftType"] {
    // Check for cargo airline prefixes
    if (callsign) {
      const prefix = callsign.substring(0, 3);
      if (CARGO_AIRLINE_PREFIXES.includes(prefix)) {
        return "cargo";
      }

      // Check for private jet patterns
      for (const pattern of PRIVATE_JET_PATTERNS) {
        if (pattern.test(callsign)) {
          return "private_jet";
        }
      }
    }

    // Fall back to OpenSky category
    return openSkyCategoryToAircraftType(category);
  }

  /**
   * Get all aircraft in the air globally (use sparingly - high rate limit impact)
   */
  async getAllStates(): Promise<OpenSkyResponse> {
    const url = `${OPENSKY_API_URL}/states/all`;

    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString(
        "base64"
      );
      headers.Authorization = `Basic ${auth}`;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`);
    }

    return (await response.json()) as OpenSkyResponse;
  }

  /**
   * Get flights for a specific aircraft in a time range
   */
  async getFlightsByAircraft(
    icao24: string,
    beginTimestamp: number,
    endTimestamp: number
  ): Promise<
    Array<{
      icao24: string;
      firstSeen: number;
      estDepartureAirport: string | null;
      lastSeen: number;
      estArrivalAirport: string | null;
      callsign: string | null;
    }>
  > {
    const url = new URL(`${OPENSKY_API_URL}/flights/aircraft`);
    url.searchParams.set("icao24", icao24);
    url.searchParams.set("begin", String(beginTimestamp));
    url.searchParams.set("end", String(endTimestamp));

    const headers: Record<string, string> = {};
    if (this.username && this.password) {
      const auth = Buffer.from(`${this.username}:${this.password}`).toString(
        "base64"
      );
      headers.Authorization = `Basic ${auth}`;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`);
    }

    return (await response.json()) as Array<{
      icao24: string;
      firstSeen: number;
      estDepartureAirport: string | null;
      lastSeen: number;
      estArrivalAirport: string | null;
      callsign: string | null;
    }>;
  }
}

// Singleton instance
export const openSkyCollector = new OpenSkyCollector();
