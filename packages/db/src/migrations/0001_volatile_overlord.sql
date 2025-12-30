DO $$ BEGIN
  CREATE TYPE "public"."import_status" AS ENUM('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."market_category" AS ENUM('spot', 'linear');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."exchange" AS ENUM('bybit', 'binance', 'tinkoff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."order_type" AS ENUM('market', 'limit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."position_side" AS ENUM('long', 'short');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."position_status" AS ENUM('open', 'closed', 'liquidated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."signal_source" AS ENUM('backtest', 'webhook', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."signal_status" AS ENUM('pending', 'executed', 'rejected', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "data_import" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"category" "market_category" NOT NULL,
	"interval" text NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"total_records" integer DEFAULT 0 NOT NULL,
	"file_path" text,
	"error" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exchange_account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange" "exchange" NOT NULL,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"api_secret" text NOT NULL,
	"testnet" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "portfolio" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_currency" text DEFAULT 'USDT' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "position" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange_account_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" "position_side" NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"current_price" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8),
	"realized_pnl" numeric(20, 8),
	"status" "position_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signal" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source" "signal_source" NOT NULL,
	"symbol" text NOT NULL,
	"side" "position_side" NOT NULL,
	"strength" numeric(5, 2),
	"metadata" jsonb,
	"status" "signal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"executed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"exchange_account_id" text NOT NULL,
	"position_id" text,
	"symbol" text NOT NULL,
	"side" "position_side" NOT NULL,
	"order_type" "order_type" NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"commission" numeric(20, 8),
	"external_id" text,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polymarket_event" (
	"id" text PRIMARY KEY NOT NULL,
	"ticker" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_date" timestamp,
	"end_date" timestamp,
	"image" text,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"liquidity" double precision,
	"volume" double precision,
	"volume_24hr" double precision,
	"open_interest" double precision,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polymarket_market" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"question" text NOT NULL,
	"slug" text,
	"description" text,
	"outcomes" jsonb,
	"outcome_prices" jsonb,
	"volume" double precision,
	"volume_24hr" double precision,
	"liquidity" double precision,
	"best_bid" double precision,
	"best_ask" double precision,
	"last_trade_price" double precision,
	"spread" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"condition_id" text,
	"clob_token_ids" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "data_import" ADD CONSTRAINT "data_import_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "exchange_account" ADD CONSTRAINT "exchange_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "position" ADD CONSTRAINT "position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "position" ADD CONSTRAINT "position_exchange_account_id_exchange_account_id_fk" FOREIGN KEY ("exchange_account_id") REFERENCES "public"."exchange_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "signal" ADD CONSTRAINT "signal_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trade" ADD CONSTRAINT "trade_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trade" ADD CONSTRAINT "trade_exchange_account_id_exchange_account_id_fk" FOREIGN KEY ("exchange_account_id") REFERENCES "public"."exchange_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "trade" ADD CONSTRAINT "trade_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "polymarket_market" ADD CONSTRAINT "polymarket_market_event_id_polymarket_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."polymarket_event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_import_userId_idx" ON "data_import" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_import_status_idx" ON "data_import" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_import_exchange_idx" ON "data_import" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_import_symbol_idx" ON "data_import" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchange_account_user_idx" ON "exchange_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchange_account_exchange_idx" ON "exchange_account" USING btree ("exchange");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portfolio_user_idx" ON "portfolio" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "position_user_idx" ON "position" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "position_exchange_account_idx" ON "position" USING btree ("exchange_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "position_status_idx" ON "position" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "position_symbol_idx" ON "position" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_user_idx" ON "signal" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_status_idx" ON "signal" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signal_created_at_idx" ON "signal" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_user_idx" ON "trade" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_exchange_account_idx" ON "trade" USING btree ("exchange_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_symbol_idx" ON "trade" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_executed_at_idx" ON "trade" USING btree ("executed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_event_slug_idx" ON "polymarket_event" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_event_active_idx" ON "polymarket_event" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_event_closed_idx" ON "polymarket_event" USING btree ("closed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_event_volume_idx" ON "polymarket_event" USING btree ("volume");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_market_event_id_idx" ON "polymarket_market" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_market_active_idx" ON "polymarket_market" USING btree ("active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polymarket_market_volume_idx" ON "polymarket_market" USING btree ("volume");