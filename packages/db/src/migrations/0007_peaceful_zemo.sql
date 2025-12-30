CREATE TYPE "public"."agent_status" AS ENUM('backtesting', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."agent_strategy_type" AS ENUM('news', 'technical', 'transport', 'macro', 'prediction', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."agent_trade_status" AS ENUM('open', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('active', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."creation_type" AS ENUM('ai', 'user', 'system');--> statement-breakpoint
CREATE TYPE "public"."market_outcome" AS ENUM('yes', 'no', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."market_position_side" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('pending', 'active', 'paused', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."prediction_market_category" AS ENUM('macro', 'crypto', 'corporate', 'geo', 'commodity', 'other');--> statement-breakpoint
CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"avatar_url" text,
	"strategy_type" "agent_strategy_type" NOT NULL,
	"strategy" jsonb NOT NULL,
	"risk_params" jsonb NOT NULL,
	"risk_level" "risk_level" DEFAULT 'medium' NOT NULL,
	"status" "agent_status" DEFAULT 'backtesting' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"total_return" numeric(12, 4),
	"monthly_return" numeric(10, 4),
	"sharpe_ratio" numeric(8, 4),
	"max_drawdown" numeric(8, 4),
	"win_rate" numeric(6, 4),
	"total_trades" integer DEFAULT 0 NOT NULL,
	"avg_holding_period_hours" numeric(10, 2),
	"total_allocated" numeric(20, 8) DEFAULT '0' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "agent_allocation" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"current_value" numeric(20, 8),
	"status" "allocation_status" DEFAULT 'active' NOT NULL,
	"realized_pnl" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8),
	"allocated_at" timestamp DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_trade" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"entry_price" numeric(24, 12) NOT NULL,
	"exit_price" numeric(24, 12),
	"stop_loss" numeric(24, 12),
	"take_profit" numeric(24, 12),
	"reasoning" text,
	"data_sources" jsonb,
	"confidence" numeric(5, 4),
	"status" "agent_trade_status" DEFAULT 'open' NOT NULL,
	"pnl" numeric(20, 8),
	"pnl_percent" numeric(10, 4),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auto_trading_config" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"exchange_account_id" text,
	"min_signal_strength" numeric(5, 2) DEFAULT '75',
	"allowed_sources" jsonb DEFAULT '["llm"]'::jsonb,
	"allowed_symbols" jsonb,
	"blocked_symbols" jsonb,
	"allow_long" boolean DEFAULT true NOT NULL,
	"allow_short" boolean DEFAULT true NOT NULL,
	"position_size_type" text DEFAULT 'fixed' NOT NULL,
	"position_size_value" numeric(20, 8) DEFAULT '100',
	"max_position_size" numeric(20, 8) DEFAULT '1000',
	"default_stop_loss_percent" numeric(5, 2) DEFAULT '5',
	"default_take_profit_percent" numeric(5, 2) DEFAULT '10',
	"max_daily_trades" numeric(5, 0) DEFAULT '10',
	"max_open_positions" numeric(5, 0) DEFAULT '5',
	"max_daily_loss_percent" numeric(5, 2) DEFAULT '5',
	"order_type" text DEFAULT 'market' NOT NULL,
	"use_stop_loss" boolean DEFAULT true NOT NULL,
	"use_take_profit" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auto_trading_config_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auto_trading_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"signal_id" text,
	"action" text NOT NULL,
	"reason" text,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"telegram_chat_id" text,
	"telegram_enabled" boolean DEFAULT false NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"notify_new_signals" boolean DEFAULT true NOT NULL,
	"notify_trade_opened" boolean DEFAULT true NOT NULL,
	"notify_trade_closed" boolean DEFAULT true NOT NULL,
	"notify_trend_alerts" boolean DEFAULT false NOT NULL,
	"notify_transport_signals" boolean DEFAULT false NOT NULL,
	"min_signal_strength" text DEFAULT '50',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "market_position" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"user_id" text,
	"agent_id" text,
	"side" "market_position_side" NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"avg_price" numeric(5, 2) NOT NULL,
	"total_cost" numeric(20, 8) NOT NULL,
	"realized_pnl" numeric(20, 8),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_trade" (
	"id" text PRIMARY KEY NOT NULL,
	"market_id" text NOT NULL,
	"user_id" text,
	"agent_id" text,
	"side" "market_position_side" NOT NULL,
	"action" text NOT NULL,
	"shares" numeric(20, 8) NOT NULL,
	"price" numeric(5, 2) NOT NULL,
	"cost" numeric(20, 8) NOT NULL,
	"price_before_trade" numeric(5, 2) NOT NULL,
	"price_after_trade" numeric(5, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_market" (
	"id" text PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"description" text,
	"category" "prediction_market_category" NOT NULL,
	"source_article_id" text,
	"created_by" text,
	"creation_type" "creation_type" DEFAULT 'ai' NOT NULL,
	"yes_price" numeric(5, 2) DEFAULT '50' NOT NULL,
	"liquidity" numeric(20, 8) DEFAULT '1000' NOT NULL,
	"total_volume" numeric(20, 8) DEFAULT '0' NOT NULL,
	"yes_shares" numeric(20, 8) DEFAULT '0' NOT NULL,
	"no_shares" numeric(20, 8) DEFAULT '0' NOT NULL,
	"resolution_criteria" jsonb NOT NULL,
	"resolution_source" text,
	"resolves_at" timestamp NOT NULL,
	"resolved_at" timestamp,
	"outcome" "market_outcome",
	"resolution_notes" text,
	"status" "market_status" DEFAULT 'pending' NOT NULL,
	"related_symbols" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "strategy_userId_idx";--> statement-breakpoint
DROP INDEX "strategy_name_idx";--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "entry_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "exit_price" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "exit_at" timestamp;--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "realized_pnl" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "holding_period_minutes" numeric(10, 0);--> statement-breakpoint
ALTER TABLE "signal" ADD COLUMN "is_win" boolean;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "config" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "lean_code" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "last_backtest_id" text;--> statement-breakpoint
ALTER TABLE "strategy" ADD COLUMN "backtest_count" text DEFAULT '0';--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_allocation" ADD CONSTRAINT "agent_allocation_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_allocation" ADD CONSTRAINT "agent_allocation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trade" ADD CONSTRAINT "agent_trade_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_trading_config" ADD CONSTRAINT "auto_trading_config_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_trading_config" ADD CONSTRAINT "auto_trading_config_exchange_account_id_exchange_account_id_fk" FOREIGN KEY ("exchange_account_id") REFERENCES "public"."exchange_account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_trading_log" ADD CONSTRAINT "auto_trading_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_position" ADD CONSTRAINT "market_position_market_id_prediction_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_position" ADD CONSTRAINT "market_position_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_position" ADD CONSTRAINT "market_position_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade" ADD CONSTRAINT "market_trade_market_id_prediction_market_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_market"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade" ADD CONSTRAINT "market_trade_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trade" ADD CONSTRAINT "market_trade_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_market" ADD CONSTRAINT "prediction_market_source_article_id_news_article_id_fk" FOREIGN KEY ("source_article_id") REFERENCES "public"."news_article"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_market" ADD CONSTRAINT "prediction_market_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_status_idx" ON "agent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_strategy_type_idx" ON "agent" USING btree ("strategy_type");--> statement-breakpoint
CREATE INDEX "agent_public_idx" ON "agent" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "agent_total_return_idx" ON "agent" USING btree ("total_return");--> statement-breakpoint
CREATE INDEX "agent_created_by_idx" ON "agent" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_allocation_unique_idx" ON "agent_allocation" USING btree ("agent_id","user_id");--> statement-breakpoint
CREATE INDEX "agent_allocation_agent_idx" ON "agent_allocation" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_allocation_user_idx" ON "agent_allocation" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_allocation_status_idx" ON "agent_allocation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_trade_agent_idx" ON "agent_trade" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_trade_symbol_idx" ON "agent_trade" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "agent_trade_status_idx" ON "agent_trade" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_trade_opened_at_idx" ON "agent_trade" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX "auto_trading_config_user_idx" ON "auto_trading_config" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auto_trading_log_user_idx" ON "auto_trading_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auto_trading_log_created_at_idx" ON "auto_trading_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_settings_user_idx" ON "notification_settings" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_position_unique_idx" ON "market_position" USING btree ("market_id","user_id","side");--> statement-breakpoint
CREATE INDEX "market_position_market_idx" ON "market_position" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_position_user_idx" ON "market_position" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_position_agent_idx" ON "market_position" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "market_trade_market_idx" ON "market_trade" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "market_trade_user_idx" ON "market_trade" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "market_trade_agent_idx" ON "market_trade" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "market_trade_created_at_idx" ON "market_trade" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prediction_market_category_idx" ON "prediction_market" USING btree ("category");--> statement-breakpoint
CREATE INDEX "prediction_market_status_idx" ON "prediction_market" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prediction_market_resolves_at_idx" ON "prediction_market" USING btree ("resolves_at");--> statement-breakpoint
CREATE INDEX "prediction_market_volume_idx" ON "prediction_market" USING btree ("total_volume");--> statement-breakpoint
CREATE INDEX "prediction_market_created_at_idx" ON "prediction_market" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "prediction_market_source_article_idx" ON "prediction_market" USING btree ("source_article_id");--> statement-breakpoint
CREATE INDEX "strategy_user_idx" ON "strategy" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "strategy_public_idx" ON "strategy" USING btree ("is_public");--> statement-breakpoint
ALTER TABLE "strategy" DROP COLUMN "path";