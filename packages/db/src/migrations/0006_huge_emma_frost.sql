CREATE TYPE "public"."aircraft_type" AS ENUM('cargo', 'passenger', 'private_jet', 'helicopter', 'military', 'other');--> statement-breakpoint
CREATE TYPE "public"."commodity_type" AS ENUM('crude_oil', 'brent', 'natural_gas', 'lng', 'lpg', 'wheat', 'corn', 'soybeans', 'rice', 'copper', 'aluminum', 'iron_ore', 'coal', 'container_freight', 'other');--> statement-breakpoint
CREATE TYPE "public"."signal_direction" AS ENUM('bullish', 'bearish', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."transport_signal_type" AS ENUM('tanker_surge', 'tanker_decline', 'bulk_flow_increase', 'bulk_flow_drop', 'port_congestion', 'port_clearing', 'route_change', 'private_jet_cluster', 'cargo_surge', 'supply_disruption');--> statement-breakpoint
CREATE TYPE "public"."transport_source" AS ENUM('opensky', 'aishub', 'marinetraffic', 'flightaware', 'manual');--> statement-breakpoint
CREATE TYPE "public"."vessel_type" AS ENUM('tanker_crude', 'tanker_product', 'tanker_chemical', 'tanker_lng', 'tanker_lpg', 'bulk_carrier', 'container', 'general_cargo', 'ore_carrier', 'ro_ro', 'passenger', 'fishing', 'tug', 'other');--> statement-breakpoint
CREATE TABLE "transport_aircraft" (
	"id" text PRIMARY KEY NOT NULL,
	"icao24" text NOT NULL,
	"registration" text,
	"callsign" text,
	"aircraft_type" "aircraft_type" NOT NULL,
	"model" text,
	"manufacturer" text,
	"operator" text,
	"country" text,
	"source" "transport_source" NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transport_aircraft_icao24_unique" UNIQUE("icao24")
);
--> statement-breakpoint
CREATE TABLE "transport_flow" (
	"id" text PRIMARY KEY NOT NULL,
	"commodity" "commodity_type" NOT NULL,
	"origin_region" text NOT NULL,
	"destination_region" text NOT NULL,
	"period" text NOT NULL,
	"period_type" text NOT NULL,
	"vessel_count" integer NOT NULL,
	"total_volume" numeric(16, 2) NOT NULL,
	"avg_transit_time" numeric(8, 2),
	"volume_change" numeric(8, 4),
	"vessel_count_change" numeric(8, 4),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_port" (
	"id" text PRIMARY KEY NOT NULL,
	"unlocode" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"port_type" text,
	"primary_commodities" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transport_port_unlocode_unique" UNIQUE("unlocode")
);
--> statement-breakpoint
CREATE TABLE "transport_port_call" (
	"id" text PRIMARY KEY NOT NULL,
	"vessel_id" text NOT NULL,
	"port_id" text NOT NULL,
	"arrival_time" timestamp,
	"departure_time" timestamp,
	"waiting_time" integer,
	"cargo" "commodity_type",
	"cargo_volume" numeric(14, 2),
	"is_loading" boolean,
	"source" "transport_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_position" (
	"id" text PRIMARY KEY NOT NULL,
	"vessel_id" text,
	"aircraft_id" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"altitude" double precision,
	"speed" double precision,
	"heading" double precision,
	"course" double precision,
	"timestamp" timestamp NOT NULL,
	"source" "transport_source" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_route" (
	"id" text PRIMARY KEY NOT NULL,
	"vessel_id" text NOT NULL,
	"origin_port_id" text,
	"destination_port_id" text,
	"origin_region" text,
	"destination_region" text,
	"commodity" "commodity_type",
	"estimated_volume" numeric(14, 2),
	"departure_time" timestamp,
	"estimated_arrival" timestamp,
	"actual_arrival" timestamp,
	"distance" numeric(10, 2),
	"is_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_signal" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_type" "transport_signal_type" NOT NULL,
	"commodity" "commodity_type",
	"direction" "signal_direction" NOT NULL,
	"strength" numeric(5, 2) NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"region" text,
	"description" text NOT NULL,
	"trigger_value" numeric(12, 4),
	"baseline_value" numeric(12, 4),
	"change_percent" numeric(8, 4),
	"affected_tickers" jsonb,
	"metadata" jsonb,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_vessel" (
	"id" text PRIMARY KEY NOT NULL,
	"mmsi" text NOT NULL,
	"imo" text,
	"name" text,
	"callsign" text,
	"vessel_type" "vessel_type" NOT NULL,
	"flag" text,
	"length" numeric(10, 2),
	"width" numeric(10, 2),
	"deadweight" numeric(12, 2),
	"gross_tonnage" numeric(12, 2),
	"year_built" integer,
	"source" "transport_source" NOT NULL,
	"metadata" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transport_vessel_mmsi_unique" UNIQUE("mmsi")
);
--> statement-breakpoint
ALTER TABLE "transport_port_call" ADD CONSTRAINT "transport_port_call_vessel_id_transport_vessel_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "public"."transport_vessel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_port_call" ADD CONSTRAINT "transport_port_call_port_id_transport_port_id_fk" FOREIGN KEY ("port_id") REFERENCES "public"."transport_port"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_position" ADD CONSTRAINT "transport_position_vessel_id_transport_vessel_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "public"."transport_vessel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_position" ADD CONSTRAINT "transport_position_aircraft_id_transport_aircraft_id_fk" FOREIGN KEY ("aircraft_id") REFERENCES "public"."transport_aircraft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_route" ADD CONSTRAINT "transport_route_vessel_id_transport_vessel_id_fk" FOREIGN KEY ("vessel_id") REFERENCES "public"."transport_vessel"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_route" ADD CONSTRAINT "transport_route_origin_port_id_transport_port_id_fk" FOREIGN KEY ("origin_port_id") REFERENCES "public"."transport_port"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_route" ADD CONSTRAINT "transport_route_destination_port_id_transport_port_id_fk" FOREIGN KEY ("destination_port_id") REFERENCES "public"."transport_port"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transport_aircraft_icao24_idx" ON "transport_aircraft" USING btree ("icao24");--> statement-breakpoint
CREATE INDEX "transport_aircraft_type_idx" ON "transport_aircraft" USING btree ("aircraft_type");--> statement-breakpoint
CREATE INDEX "transport_aircraft_operator_idx" ON "transport_aircraft" USING btree ("operator");--> statement-breakpoint
CREATE INDEX "transport_aircraft_active_idx" ON "transport_aircraft" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_flow_unique_idx" ON "transport_flow" USING btree ("commodity","origin_region","destination_region","period");--> statement-breakpoint
CREATE INDEX "transport_flow_commodity_idx" ON "transport_flow" USING btree ("commodity");--> statement-breakpoint
CREATE INDEX "transport_flow_origin_idx" ON "transport_flow" USING btree ("origin_region");--> statement-breakpoint
CREATE INDEX "transport_flow_destination_idx" ON "transport_flow" USING btree ("destination_region");--> statement-breakpoint
CREATE INDEX "transport_flow_period_idx" ON "transport_flow" USING btree ("period");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_port_unlocode_idx" ON "transport_port" USING btree ("unlocode");--> statement-breakpoint
CREATE INDEX "transport_port_country_idx" ON "transport_port" USING btree ("country");--> statement-breakpoint
CREATE INDEX "transport_port_geo_idx" ON "transport_port" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "transport_port_call_vessel_idx" ON "transport_port_call" USING btree ("vessel_id");--> statement-breakpoint
CREATE INDEX "transport_port_call_port_idx" ON "transport_port_call" USING btree ("port_id");--> statement-breakpoint
CREATE INDEX "transport_port_call_arrival_idx" ON "transport_port_call" USING btree ("arrival_time");--> statement-breakpoint
CREATE INDEX "transport_port_call_cargo_idx" ON "transport_port_call" USING btree ("cargo");--> statement-breakpoint
CREATE INDEX "transport_position_vessel_idx" ON "transport_position" USING btree ("vessel_id");--> statement-breakpoint
CREATE INDEX "transport_position_aircraft_idx" ON "transport_position" USING btree ("aircraft_id");--> statement-breakpoint
CREATE INDEX "transport_position_timestamp_idx" ON "transport_position" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "transport_position_geo_idx" ON "transport_position" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "transport_route_vessel_idx" ON "transport_route" USING btree ("vessel_id");--> statement-breakpoint
CREATE INDEX "transport_route_origin_idx" ON "transport_route" USING btree ("origin_port_id");--> statement-breakpoint
CREATE INDEX "transport_route_destination_idx" ON "transport_route" USING btree ("destination_port_id");--> statement-breakpoint
CREATE INDEX "transport_route_commodity_idx" ON "transport_route" USING btree ("commodity");--> statement-breakpoint
CREATE INDEX "transport_route_departure_idx" ON "transport_route" USING btree ("departure_time");--> statement-breakpoint
CREATE INDEX "transport_route_completed_idx" ON "transport_route" USING btree ("is_completed");--> statement-breakpoint
CREATE INDEX "transport_signal_type_idx" ON "transport_signal" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "transport_signal_commodity_idx" ON "transport_signal" USING btree ("commodity");--> statement-breakpoint
CREATE INDEX "transport_signal_direction_idx" ON "transport_signal" USING btree ("direction");--> statement-breakpoint
CREATE INDEX "transport_signal_active_idx" ON "transport_signal" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "transport_signal_created_idx" ON "transport_signal" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transport_vessel_mmsi_idx" ON "transport_vessel" USING btree ("mmsi");--> statement-breakpoint
CREATE INDEX "transport_vessel_type_idx" ON "transport_vessel" USING btree ("vessel_type");--> statement-breakpoint
CREATE INDEX "transport_vessel_flag_idx" ON "transport_vessel" USING btree ("flag");--> statement-breakpoint
CREATE INDEX "transport_vessel_active_idx" ON "transport_vessel" USING btree ("is_active");