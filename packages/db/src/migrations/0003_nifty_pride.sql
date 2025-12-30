CREATE TABLE "polymarket_asset_mapping" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"symbol" text NOT NULL,
	"relevance" double precision NOT NULL,
	"impact_direction" text,
	"auto_detected" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"market_id" text,
	"user_address" text,
	"content" text NOT NULL,
	"parent_id" text,
	"reactions" jsonb,
	"created_at" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_holder" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"pseudonym" text,
	"amount" double precision NOT NULL,
	"rank" text,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_price_history" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"token_id" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"price" double precision NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polymarket_probability_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"probability" double precision NOT NULL,
	"volume_24h" double precision,
	"liquidity" double precision,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "polymarket_asset_mapping" ADD CONSTRAINT "polymarket_asset_mapping_event_id_polymarket_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."polymarket_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_comment" ADD CONSTRAINT "polymarket_comment_event_id_polymarket_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."polymarket_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_comment" ADD CONSTRAINT "polymarket_comment_market_id_polymarket_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."polymarket_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_holder" ADD CONSTRAINT "polymarket_holder_market_id_polymarket_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."polymarket_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_price_history" ADD CONSTRAINT "polymarket_price_history_market_id_polymarket_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."polymarket_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polymarket_probability_snapshot" ADD CONSTRAINT "polymarket_probability_snapshot_market_id_polymarket_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."polymarket_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pm_asset_mapping_event_idx" ON "polymarket_asset_mapping" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "pm_asset_mapping_symbol_idx" ON "polymarket_asset_mapping" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "pm_comment_event_idx" ON "polymarket_comment" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "pm_comment_market_idx" ON "polymarket_comment" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_comment_created_idx" ON "polymarket_comment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pm_holder_market_idx" ON "polymarket_holder" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_holder_wallet_idx" ON "polymarket_holder" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "pm_price_history_market_idx" ON "polymarket_price_history" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_price_history_timestamp_idx" ON "polymarket_price_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "pm_snapshot_market_idx" ON "polymarket_probability_snapshot" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "pm_snapshot_timestamp_idx" ON "polymarket_probability_snapshot" USING btree ("timestamp");