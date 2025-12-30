import type {
  transportAircraft,
  transportFlow,
  transportPortCall,
  transportPosition,
  transportRoute,
  transportSignal,
  transportVessel,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";

// ===== Database Types =====
export type TransportVessel = InferSelectModel<typeof transportVessel>;
export type TransportAircraft = InferSelectModel<typeof transportAircraft>;
export type TransportPosition = InferSelectModel<typeof transportPosition>;
export type TransportPortCall = InferSelectModel<typeof transportPortCall>;
export type TransportRoute = InferSelectModel<typeof transportRoute>;
export type TransportFlow = InferSelectModel<typeof transportFlow>;
export type TransportSignal = InferSelectModel<typeof transportSignal>;

// ===== Enums =====
export type VesselType =
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
  | "other";

export type AircraftType =
  | "cargo"
  | "passenger"
  | "private_jet"
  | "helicopter"
  | "military"
  | "other";

export type TransportSource =
  | "opensky"
  | "aishub"
  | "marinetraffic"
  | "flightaware"
  | "manual";

export type CommodityType =
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
  | "other";

export type SignalType =
  | "tanker_surge"
  | "tanker_decline"
  | "bulk_flow_increase"
  | "bulk_flow_drop"
  | "port_congestion"
  | "port_clearing"
  | "route_change"
  | "private_jet_cluster"
  | "cargo_surge"
  | "supply_disruption";

export type SignalDirection = "bullish" | "bearish" | "neutral";

// ===== Collector Types =====

// OpenSky API response types
export interface OpenSkyState {
  icao24: string;
  callsign: string | null;
  origin_country: string;
  time_position: number | null;
  last_contact: number;
  longitude: number | null;
  latitude: number | null;
  baro_altitude: number | null;
  on_ground: boolean;
  velocity: number | null;
  true_track: number | null;
  vertical_rate: number | null;
  sensors: number[] | null;
  geo_altitude: number | null;
  squawk: string | null;
  spi: boolean;
  position_source: number;
}

export interface OpenSkyResponse {
  time: number;
  states: Array<
    [
      string, // icao24
      string | null, // callsign
      string, // origin_country
      number | null, // time_position
      number, // last_contact
      number | null, // longitude
      number | null, // latitude
      number | null, // baro_altitude
      boolean, // on_ground
      number | null, // velocity
      number | null, // true_track
      number | null, // vertical_rate
      number[] | null, // sensors
      number | null, // geo_altitude
      string | null, // squawk
      boolean, // spi
      number, // position_source
    ]
  > | null;
}

// AIS data types
export interface AISPosition {
  mmsi: string;
  imo?: string;
  name?: string;
  callsign?: string;
  ship_type: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  heading: number;
  timestamp: number;
  destination?: string;
  eta?: string;
  draught?: number;
  status?: number;
}

// Collected data types
export interface CollectedVessel {
  mmsi: string;
  imo?: string;
  name?: string;
  callsign?: string;
  vesselType: VesselType;
  flag?: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  course?: number;
  destination?: string;
  timestamp: Date;
}

export interface CollectedAircraft {
  icao24: string;
  callsign?: string;
  country: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  velocity?: number;
  heading?: number;
  onGround: boolean;
  timestamp: Date;
}

// ===== Analysis Types =====

export interface FlowAnalysis {
  commodity: CommodityType;
  originRegion: string;
  destinationRegion: string;
  period: string;
  periodType: "daily" | "weekly" | "monthly";
  vesselCount: number;
  totalVolume: number;
  volumeChange: number; // percentage
  vesselCountChange: number; // percentage
  avgTransitTime?: number;
}

export interface CongestionAnalysis {
  portId: string;
  portName: string;
  vesselCount: number;
  avgWaitTime: number; // hours
  normalWaitTime: number; // hours
  congestionRatio: number; // current / normal
  affectedCommodities: CommodityType[];
}

export interface SignalInput {
  type: SignalType;
  commodity?: CommodityType;
  region?: string;
  triggerValue: number;
  baselineValue: number;
  description: string;
  affectedTickers?: string[];
  metadata?: Record<string, unknown>;
}

// ===== Region Mappings =====

export const MAJOR_REGIONS = [
  "Persian Gulf",
  "US Gulf",
  "West Africa",
  "North Sea",
  "Baltic Sea",
  "Mediterranean",
  "Black Sea",
  "South America East",
  "South America West",
  "Southeast Asia",
  "East Asia",
  "Australia",
  "India",
] as const;

export type MajorRegion = (typeof MAJOR_REGIONS)[number];

// Vessel type to commodity mapping
export const VESSEL_TYPE_TO_COMMODITY: Record<VesselType, CommodityType[]> = {
  tanker_crude: ["crude_oil", "brent"],
  tanker_product: ["crude_oil"],
  tanker_chemical: ["other"],
  tanker_lng: ["lng", "natural_gas"],
  tanker_lpg: ["lpg"],
  bulk_carrier: ["wheat", "corn", "soybeans", "rice", "coal", "iron_ore"],
  container: ["container_freight"],
  general_cargo: ["other"],
  ore_carrier: ["iron_ore", "copper", "aluminum"],
  ro_ro: ["other"],
  passenger: ["other"],
  fishing: ["other"],
  tug: ["other"],
  other: ["other"],
};

// Commodity to ticker mapping
export const COMMODITY_TO_TICKERS: Record<CommodityType, string[]> = {
  crude_oil: ["CL", "USO", "XLE"],
  brent: ["BZ", "BNO"],
  natural_gas: ["NG", "UNG"],
  lng: ["NG", "LNG"],
  lpg: ["NG"],
  wheat: ["ZW", "WEAT"],
  corn: ["ZC", "CORN"],
  soybeans: ["ZS", "SOYB"],
  rice: ["ZR"],
  copper: ["HG", "CPER"],
  aluminum: ["ALI"],
  iron_ore: ["VALE", "RIO", "BHP"],
  coal: ["BTU", "ARCH"],
  container_freight: ["ZIM", "DAC", "MATX"],
  other: [],
};

// ===== Collector Interface =====

export interface ITransportCollector {
  readonly name: string;
  readonly source: TransportSource;

  collectVessels?(): Promise<CollectedVessel[]>;
  collectAircraft?(): Promise<CollectedAircraft[]>;
}

// ===== Extended Types for Collectors =====

export interface VesselInfo {
  mmsi: string;
  imo?: string;
  name?: string;
  callsign?: string;
  vesselType: VesselType;
  flag?: string;
  length?: number;
  width?: number;
  deadweight?: number;
  source: TransportSource;
  metadata?: Record<string, unknown>;
}

export interface AircraftInfo {
  icao24: string;
  registration?: string;
  callsign?: string;
  aircraftType: AircraftType;
  model?: string;
  manufacturer?: string;
  operator?: string;
  country?: string;
  source: TransportSource;
  metadata?: Record<string, unknown>;
}

export interface Position {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  course?: number;
  timestamp: Date;
}

export interface TransportCollectResult {
  vesselsCollected: number;
  aircraftCollected: number;
  positionsRecorded: number;
  errors: string[];
}

// ===== AIS Hub Response Types =====

export interface AISHubVessel {
  MMSI: string;
  IMO?: string;
  NAME?: string;
  CALLSIGN?: string;
  TYPE: number;
  A?: number; // Length A
  B?: number; // Length B
  C?: number; // Width C
  D?: number; // Width D
  DRAUGHT?: number;
  DESTINATION?: string;
  ETA?: string;
  LATITUDE: number;
  LONGITUDE: number;
  SOG: number; // Speed over ground
  COG: number; // Course over ground
  HEADING: number;
  NAVSTAT: number;
  TIME: string;
}

export interface AISHubResponse {
  ERROR: boolean;
  ERROR_MESSAGE?: string;
  RECORDS?: number;
  DATA?: AISHubVessel[];
}

// ===== Region Bounds for Geo Detection =====

export const REGION_BOUNDS: Record<
  MajorRegion,
  {
    name: string;
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  }
> = {
  "Persian Gulf": {
    name: "Persian Gulf",
    minLat: 22,
    maxLat: 32,
    minLon: 47,
    maxLon: 60,
  },
  "US Gulf": {
    name: "US Gulf",
    minLat: 25,
    maxLat: 32,
    minLon: -98,
    maxLon: -80,
  },
  "West Africa": {
    name: "West Africa",
    minLat: -10,
    maxLat: 15,
    minLon: -20,
    maxLon: 15,
  },
  "North Sea": {
    name: "North Sea",
    minLat: 50,
    maxLat: 62,
    minLon: -5,
    maxLon: 12,
  },
  "Baltic Sea": {
    name: "Baltic Sea",
    minLat: 53,
    maxLat: 66,
    minLon: 10,
    maxLon: 30,
  },
  Mediterranean: {
    name: "Mediterranean",
    minLat: 30,
    maxLat: 46,
    minLon: -6,
    maxLon: 36,
  },
  "Black Sea": {
    name: "Black Sea",
    minLat: 40,
    maxLat: 47,
    minLon: 27,
    maxLon: 42,
  },
  "South America East": {
    name: "South America East",
    minLat: -40,
    maxLat: 5,
    minLon: -55,
    maxLon: -30,
  },
  "South America West": {
    name: "South America West",
    minLat: -40,
    maxLat: 5,
    minLon: -85,
    maxLon: -70,
  },
  "Southeast Asia": {
    name: "Southeast Asia",
    minLat: -10,
    maxLat: 25,
    minLon: 95,
    maxLon: 130,
  },
  "East Asia": {
    name: "East Asia",
    minLat: 20,
    maxLat: 45,
    minLon: 115,
    maxLon: 145,
  },
  Australia: {
    name: "Australia",
    minLat: -45,
    maxLat: -10,
    minLon: 110,
    maxLon: 155,
  },
  India: { name: "India", minLat: 5, maxLat: 25, minLon: 68, maxLon: 90 },
};

// ===== Helper Functions =====

/**
 * Convert AIS ship type code to VesselType
 */
export function aisTypeToVesselType(aisType: number): VesselType {
  // Tankers (80-89)
  if (aisType >= 80 && aisType <= 89) {
    if (aisType === 80 || aisType === 81 || aisType === 86)
      return "tanker_crude";
    if (aisType === 82 || aisType === 83) return "tanker_chemical";
    if (aisType === 84) return "tanker_lng";
    if (aisType === 85) return "tanker_lpg";
    return "tanker_product";
  }
  // Cargo (70-79)
  if (aisType >= 70 && aisType <= 79) {
    if (aisType === 73 || aisType === 74) return "container";
    if (aisType === 75 || aisType === 76) return "bulk_carrier";
    if (aisType === 77 || aisType === 78) return "ore_carrier";
    return "general_cargo";
  }
  // Passenger (60-69)
  if (aisType >= 60 && aisType <= 69) return "passenger";
  // Others
  if (aisType === 30) return "fishing";
  if (aisType === 31 || aisType === 32 || aisType === 52) return "tug";
  return "other";
}

/**
 * Detect which major region a coordinate belongs to
 */
export function getRegionForPosition(
  lat: number,
  lon: number
): MajorRegion | null {
  for (const [region, bounds] of Object.entries(REGION_BOUNDS)) {
    if (
      lat >= bounds.minLat &&
      lat <= bounds.maxLat &&
      lon >= bounds.minLon &&
      lon <= bounds.maxLon
    ) {
      return region as MajorRegion;
    }
  }
  return null;
}

/**
 * Convert OpenSky category to AircraftType
 */
export function openSkyCategoryToAircraftType(category: number): AircraftType {
  switch (category) {
    case 6: // Heavy - likely cargo
      return "cargo";
    case 2: // Light - likely private jet
    case 7: // High performance
      return "private_jet";
    case 8: // Rotorcraft
      return "helicopter";
    case 3: // Small
    case 4: // Large
    case 5: // High Vortex Large
      return "passenger";
    default:
      return "other";
  }
}
