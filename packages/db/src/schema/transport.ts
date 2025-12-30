import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ===== ENUMS =====

// Тип судна
export const vesselTypeEnum = pgEnum("vessel_type", [
  "tanker_crude",
  "tanker_product",
  "tanker_chemical",
  "tanker_lng",
  "tanker_lpg",
  "bulk_carrier",
  "container",
  "general_cargo",
  "ore_carrier",
  "ro_ro",
  "passenger",
  "fishing",
  "tug",
  "other",
]);

// Тип самолёта
export const aircraftTypeEnum = pgEnum("aircraft_type", [
  "cargo",
  "passenger",
  "private_jet",
  "helicopter",
  "military",
  "other",
]);

// Источник транспортных данных
export const transportSourceEnum = pgEnum("transport_source", [
  "opensky",
  "aishub",
  "marinetraffic",
  "flightaware",
  "manual",
]);

// Тип commodity
export const commodityTypeEnum = pgEnum("commodity_type", [
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
]);

// Тип сигнала
export const transportSignalTypeEnum = pgEnum("transport_signal_type", [
  "tanker_surge",
  "tanker_decline",
  "bulk_flow_increase",
  "bulk_flow_drop",
  "port_congestion",
  "port_clearing",
  "route_change",
  "private_jet_cluster",
  "cargo_surge",
  "supply_disruption",
]);

// Направление сигнала
export const signalDirectionEnum = pgEnum("signal_direction", [
  "bullish",
  "bearish",
  "neutral",
]);

// ===== TABLES =====

// Суда
export const transportVessel = pgTable(
  "transport_vessel",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    mmsi: text("mmsi").notNull().unique(), // Maritime Mobile Service Identity
    imo: text("imo"), // International Maritime Organization number
    name: text("name"),
    callsign: text("callsign"),
    vesselType: vesselTypeEnum("vessel_type").notNull(),
    flag: text("flag"), // Country code
    length: numeric("length", { precision: 10, scale: 2 }),
    width: numeric("width", { precision: 10, scale: 2 }),
    deadweight: numeric("deadweight", { precision: 12, scale: 2 }), // DWT tonnage
    grossTonnage: numeric("gross_tonnage", { precision: 12, scale: 2 }),
    yearBuilt: integer("year_built"),
    source: transportSourceEnum("source").notNull(),
    metadata: jsonb("metadata").$type<{
      owner?: string;
      operator?: string;
      class?: string;
      cargoCapacity?: number;
      lastPort?: string;
      destination?: string;
    }>(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("transport_vessel_mmsi_idx").on(table.mmsi),
    index("transport_vessel_type_idx").on(table.vesselType),
    index("transport_vessel_flag_idx").on(table.flag),
    index("transport_vessel_active_idx").on(table.isActive),
  ]
);

// Самолёты
export const transportAircraft = pgTable(
  "transport_aircraft",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    icao24: text("icao24").notNull().unique(), // ICAO 24-bit address
    registration: text("registration"), // N-number, tail number
    callsign: text("callsign"),
    aircraftType: aircraftTypeEnum("aircraft_type").notNull(),
    model: text("model"), // e.g., "Boeing 747-400F"
    manufacturer: text("manufacturer"),
    operator: text("operator"),
    country: text("country"),
    source: transportSourceEnum("source").notNull(),
    metadata: jsonb("metadata").$type<{
      serialNumber?: string;
      engineType?: string;
      maxCargoWeight?: number;
      ownerName?: string;
    }>(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("transport_aircraft_icao24_idx").on(table.icao24),
    index("transport_aircraft_type_idx").on(table.aircraftType),
    index("transport_aircraft_operator_idx").on(table.operator),
    index("transport_aircraft_active_idx").on(table.isActive),
  ]
);

// Позиции (для обоих типов транспорта)
export const transportPosition = pgTable(
  "transport_position",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vesselId: text("vessel_id").references(() => transportVessel.id, {
      onDelete: "cascade",
    }),
    aircraftId: text("aircraft_id").references(() => transportAircraft.id, {
      onDelete: "cascade",
    }),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    altitude: doublePrecision("altitude"), // meters (for aircraft)
    speed: doublePrecision("speed"), // knots for vessels, m/s for aircraft
    heading: doublePrecision("heading"), // degrees
    course: doublePrecision("course"), // degrees
    timestamp: timestamp("timestamp").notNull(),
    source: transportSourceEnum("source").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("transport_position_vessel_idx").on(table.vesselId),
    index("transport_position_aircraft_idx").on(table.aircraftId),
    index("transport_position_timestamp_idx").on(table.timestamp),
    index("transport_position_geo_idx").on(table.latitude, table.longitude),
  ]
);

// Порты
export const transportPort = pgTable(
  "transport_port",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    unlocode: text("unlocode").notNull().unique(), // UN/LOCODE
    name: text("name").notNull(),
    country: text("country").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    portType: text("port_type"), // "seaport", "inland", "oil_terminal"
    primaryCommodities: jsonb("primary_commodities").$type<string[]>(),
    metadata: jsonb("metadata").$type<{
      timezone?: string;
      maxDraft?: number;
      annualThroughput?: number;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("transport_port_unlocode_idx").on(table.unlocode),
    index("transport_port_country_idx").on(table.country),
    index("transport_port_geo_idx").on(table.latitude, table.longitude),
  ]
);

// Заходы в порты
export const transportPortCall = pgTable(
  "transport_port_call",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vesselId: text("vessel_id")
      .notNull()
      .references(() => transportVessel.id, { onDelete: "cascade" }),
    portId: text("port_id")
      .notNull()
      .references(() => transportPort.id, { onDelete: "cascade" }),
    arrivalTime: timestamp("arrival_time"),
    departureTime: timestamp("departure_time"),
    waitingTime: integer("waiting_time"), // hours
    cargo: commodityTypeEnum("cargo"),
    cargoVolume: numeric("cargo_volume", { precision: 14, scale: 2 }), // tons
    isLoading: boolean("is_loading"), // true = loading, false = unloading
    source: transportSourceEnum("source").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("transport_port_call_vessel_idx").on(table.vesselId),
    index("transport_port_call_port_idx").on(table.portId),
    index("transport_port_call_arrival_idx").on(table.arrivalTime),
    index("transport_port_call_cargo_idx").on(table.cargo),
  ]
);

// Маршруты
export const transportRoute = pgTable(
  "transport_route",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    vesselId: text("vessel_id")
      .notNull()
      .references(() => transportVessel.id, { onDelete: "cascade" }),
    originPortId: text("origin_port_id").references(() => transportPort.id),
    destinationPortId: text("destination_port_id").references(
      () => transportPort.id
    ),
    originRegion: text("origin_region"), // "Persian Gulf", "US Gulf", etc.
    destinationRegion: text("destination_region"),
    commodity: commodityTypeEnum("commodity"),
    estimatedVolume: numeric("estimated_volume", { precision: 14, scale: 2 }), // tons
    departureTime: timestamp("departure_time"),
    estimatedArrival: timestamp("estimated_arrival"),
    actualArrival: timestamp("actual_arrival"),
    distance: numeric("distance", { precision: 10, scale: 2 }), // nautical miles
    isCompleted: boolean("is_completed").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("transport_route_vessel_idx").on(table.vesselId),
    index("transport_route_origin_idx").on(table.originPortId),
    index("transport_route_destination_idx").on(table.destinationPortId),
    index("transport_route_commodity_idx").on(table.commodity),
    index("transport_route_departure_idx").on(table.departureTime),
    index("transport_route_completed_idx").on(table.isCompleted),
  ]
);

// Агрегированные потоки commodities
export const transportFlow = pgTable(
  "transport_flow",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    commodity: commodityTypeEnum("commodity").notNull(),
    originRegion: text("origin_region").notNull(),
    destinationRegion: text("destination_region").notNull(),
    period: text("period").notNull(), // "2025-01-05", "2025-W01", "2025-01"
    periodType: text("period_type").notNull(), // "daily", "weekly", "monthly"
    vesselCount: integer("vessel_count").notNull(),
    totalVolume: numeric("total_volume", { precision: 16, scale: 2 }).notNull(), // tons
    avgTransitTime: numeric("avg_transit_time", { precision: 8, scale: 2 }), // days
    volumeChange: numeric("volume_change", { precision: 8, scale: 4 }), // percentage vs prev period
    vesselCountChange: numeric("vessel_count_change", {
      precision: 8,
      scale: 4,
    }),
    metadata: jsonb("metadata").$type<{
      avgVesselSize?: number;
      topOriginPorts?: string[];
      topDestinationPorts?: string[];
      avgDwt?: number;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("transport_flow_unique_idx").on(
      table.commodity,
      table.originRegion,
      table.destinationRegion,
      table.period
    ),
    index("transport_flow_commodity_idx").on(table.commodity),
    index("transport_flow_origin_idx").on(table.originRegion),
    index("transport_flow_destination_idx").on(table.destinationRegion),
    index("transport_flow_period_idx").on(table.period),
  ]
);

// Сигналы для trading
export const transportSignal = pgTable(
  "transport_signal",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    signalType: transportSignalTypeEnum("signal_type").notNull(),
    commodity: commodityTypeEnum("commodity"),
    direction: signalDirectionEnum("direction").notNull(),
    strength: numeric("strength", { precision: 5, scale: 2 }).notNull(), // 0-100
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(), // 0-1
    region: text("region"),
    description: text("description").notNull(),
    triggerValue: numeric("trigger_value", { precision: 12, scale: 4 }),
    baselineValue: numeric("baseline_value", { precision: 12, scale: 4 }),
    changePercent: numeric("change_percent", { precision: 8, scale: 4 }),
    affectedTickers: jsonb("affected_tickers").$type<string[]>(), // ["CL", "BZ", "USO"]
    metadata: jsonb("metadata").$type<{
      vesselCount?: number;
      volumeEstimate?: number;
      portsConcerned?: string[];
      comparisonPeriod?: string;
      relatedRoutes?: string[];
    }>(),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("transport_signal_type_idx").on(table.signalType),
    index("transport_signal_commodity_idx").on(table.commodity),
    index("transport_signal_direction_idx").on(table.direction),
    index("transport_signal_active_idx").on(table.isActive),
    index("transport_signal_created_idx").on(table.createdAt),
  ]
);

// ===== RELATIONS =====

export const transportVesselRelations = relations(
  transportVessel,
  ({ many }) => ({
    positions: many(transportPosition),
    portCalls: many(transportPortCall),
    routes: many(transportRoute),
  })
);

export const transportAircraftRelations = relations(
  transportAircraft,
  ({ many }) => ({
    positions: many(transportPosition),
  })
);

export const transportPositionRelations = relations(
  transportPosition,
  ({ one }) => ({
    vessel: one(transportVessel, {
      fields: [transportPosition.vesselId],
      references: [transportVessel.id],
    }),
    aircraft: one(transportAircraft, {
      fields: [transportPosition.aircraftId],
      references: [transportAircraft.id],
    }),
  })
);

export const transportPortRelations = relations(transportPort, ({ many }) => ({
  portCalls: many(transportPortCall),
  originRoutes: many(transportRoute, { relationName: "originPort" }),
  destinationRoutes: many(transportRoute, { relationName: "destinationPort" }),
}));

export const transportPortCallRelations = relations(
  transportPortCall,
  ({ one }) => ({
    vessel: one(transportVessel, {
      fields: [transportPortCall.vesselId],
      references: [transportVessel.id],
    }),
    port: one(transportPort, {
      fields: [transportPortCall.portId],
      references: [transportPort.id],
    }),
  })
);

export const transportRouteRelations = relations(transportRoute, ({ one }) => ({
  vessel: one(transportVessel, {
    fields: [transportRoute.vesselId],
    references: [transportVessel.id],
  }),
  originPort: one(transportPort, {
    fields: [transportRoute.originPortId],
    references: [transportPort.id],
    relationName: "originPort",
  }),
  destinationPort: one(transportPort, {
    fields: [transportRoute.destinationPortId],
    references: [transportPort.id],
    relationName: "destinationPort",
  }),
}));
