CREATE TYPE "public"."data_source" AS ENUM('binance', 'bybit', 'yahoo', 'alpaca', 'moex_iss', 'tinkoff');--> statement-breakpoint
CREATE TYPE "public"."indicator_type" AS ENUM('rsi', 'macd', 'bollinger', 'ema', 'sma', 'adx', 'atr', 'volume_profile', 'support_resistance');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('crypto', 'etf', 'stock', 'moex', 'forex', 'commodity');--> statement-breakpoint
CREATE TYPE "public"."timeframe" AS ENUM('1m', '5m', '15m', '1h', '4h', '1d', '1w');--> statement-breakpoint
CREATE TYPE "public"."trend_strength" AS ENUM('weak', 'moderate', 'strong', 'very_strong');--> statement-breakpoint
CREATE TYPE "public"."trend_type" AS ENUM('uptrend', 'downtrend', 'sideways', 'breakout_up', 'breakout_down', 'reversal_bullish', 'reversal_bearish');--> statement-breakpoint
CREATE TYPE "public"."entity_subtype" AS ENUM('person', 'company', 'crypto', 'organization', 'protocol', 'exchange');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('hack', 'listing', 'delisting', 'lawsuit', 'announcement', 'partnership', 'acquisition', 'funding', 'launch', 'upgrade', 'bankruptcy');--> statement-breakpoint
CREATE TYPE "public"."relation_type" AS ENUM('co_occurrence', 'causal', 'temporal', 'hierarchical', 'competitive', 'partnership');--> statement-breakpoint
CREATE TYPE "public"."tag_type" AS ENUM('entity', 'topic', 'event', 'region');--> statement-breakpoint
CREATE TYPE "public"."topic_category" AS ENUM('regulation', 'defi', 'nft', 'macro', 'security', 'adoption', 'technology', 'market', 'governance');--> statement-breakpoint
CREATE TABLE "market_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"market_type" "market_type" NOT NULL,
	"data_source" "data_source" NOT NULL,
	"base_currency" text,
	"quote_currency" text,
	"sector" text,
	"metadata" jsonb,
	"is_active" text DEFAULT 'true' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_candle" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"timeframe" timeframe NOT NULL,
	"open_time" timestamp NOT NULL,
	"close_time" timestamp NOT NULL,
	"open" numeric(24, 12) NOT NULL,
	"high" numeric(24, 12) NOT NULL,
	"low" numeric(24, 12) NOT NULL,
	"close" numeric(24, 12) NOT NULL,
	"volume" numeric(24, 8) NOT NULL,
	"quote_volume" numeric(24, 8),
	"trades" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_correlation" (
	"id" text PRIMARY KEY NOT NULL,
	"asset1_id" text NOT NULL,
	"asset2_id" text NOT NULL,
	"timeframe" timeframe NOT NULL,
	"period" text NOT NULL,
	"correlation" numeric(6, 5) NOT NULL,
	"p_value" numeric(10, 8),
	"sample_size" numeric,
	"calculated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_indicator" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"timeframe" timeframe NOT NULL,
	"indicator_type" "indicator_type" NOT NULL,
	"timestamp" timestamp NOT NULL,
	"value" numeric(24, 12),
	"values" jsonb,
	"params" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_opportunity" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"type" text NOT NULL,
	"direction" text NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"entry_price" numeric(24, 12),
	"target_price" numeric(24, 12),
	"stop_loss" numeric(24, 12),
	"risk_reward_ratio" numeric(6, 2),
	"timeframe" timeframe NOT NULL,
	"reasoning" text NOT NULL,
	"indicators" jsonb,
	"is_active" text DEFAULT 'true' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_trend" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"timeframe" timeframe NOT NULL,
	"trend_type" "trend_type" NOT NULL,
	"strength" "trend_strength" NOT NULL,
	"confidence" numeric(5, 4) NOT NULL,
	"start_price" numeric(24, 12) NOT NULL,
	"current_price" numeric(24, 12) NOT NULL,
	"price_change" numeric(10, 4),
	"start_date" timestamp NOT NULL,
	"end_date" timestamp,
	"is_active" text DEFAULT 'true' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_tag" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"type" "tag_type" NOT NULL,
	"subtype" text,
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb,
	"total_mentions" numeric DEFAULT '0',
	"avg_sentiment" numeric(5, 4),
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_mention" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text NOT NULL,
	"article_id" text NOT NULL,
	"analysis_id" text,
	"sentiment" "sentiment",
	"sentiment_score" numeric(5, 4),
	"relevance" numeric(5, 4) NOT NULL,
	"context" text,
	"event_date" timestamp,
	"severity" numeric(3, 2),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag_relation" (
	"id" text PRIMARY KEY NOT NULL,
	"source_tag_id" text NOT NULL,
	"target_tag_id" text NOT NULL,
	"relation_type" "relation_type" NOT NULL,
	"strength" numeric(5, 4) NOT NULL,
	"co_occurrence_count" numeric DEFAULT '0',
	"avg_sentiment_delta" numeric(5, 4),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_alert" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"metrics" jsonb,
	"related_articles" jsonb,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_at" timestamp,
	"acknowledged_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trend_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"tag_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"period_type" text NOT NULL,
	"mention_count" numeric NOT NULL,
	"unique_articles" numeric NOT NULL,
	"unique_sources" numeric NOT NULL,
	"avg_sentiment" numeric(5, 4),
	"avg_relevance" numeric(5, 4),
	"velocity_change" numeric(7, 4),
	"acceleration_change" numeric(7, 4),
	"related_tags" jsonb,
	"top_articles" jsonb,
	"sentiment_distribution" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_candle" ADD CONSTRAINT "market_candle_asset_id_market_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_correlation" ADD CONSTRAINT "market_correlation_asset1_id_market_asset_id_fk" FOREIGN KEY ("asset1_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_correlation" ADD CONSTRAINT "market_correlation_asset2_id_market_asset_id_fk" FOREIGN KEY ("asset2_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_indicator" ADD CONSTRAINT "market_indicator_asset_id_market_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_opportunity" ADD CONSTRAINT "market_opportunity_asset_id_market_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_trend" ADD CONSTRAINT "market_trend_asset_id_market_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."market_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_mention" ADD CONSTRAINT "tag_mention_tag_id_news_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."news_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_mention" ADD CONSTRAINT "tag_mention_article_id_news_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_mention" ADD CONSTRAINT "tag_mention_analysis_id_news_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."news_analysis"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_relation" ADD CONSTRAINT "tag_relation_source_tag_id_news_tag_id_fk" FOREIGN KEY ("source_tag_id") REFERENCES "public"."news_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_relation" ADD CONSTRAINT "tag_relation_target_tag_id_news_tag_id_fk" FOREIGN KEY ("target_tag_id") REFERENCES "public"."news_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_alert" ADD CONSTRAINT "trend_alert_tag_id_news_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."news_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_alert" ADD CONSTRAINT "trend_alert_acknowledged_by_user_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_snapshot" ADD CONSTRAINT "trend_snapshot_tag_id_news_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."news_tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "market_asset_symbol_source_idx" ON "market_asset" USING btree ("symbol","data_source");--> statement-breakpoint
CREATE INDEX "market_asset_market_type_idx" ON "market_asset" USING btree ("market_type");--> statement-breakpoint
CREATE INDEX "market_asset_sector_idx" ON "market_asset" USING btree ("sector");--> statement-breakpoint
CREATE UNIQUE INDEX "market_candle_unique_idx" ON "market_candle" USING btree ("asset_id","timeframe","open_time");--> statement-breakpoint
CREATE INDEX "market_candle_asset_idx" ON "market_candle" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "market_candle_timeframe_idx" ON "market_candle" USING btree ("timeframe");--> statement-breakpoint
CREATE INDEX "market_candle_open_time_idx" ON "market_candle" USING btree ("open_time");--> statement-breakpoint
CREATE UNIQUE INDEX "market_correlation_unique_idx" ON "market_correlation" USING btree ("asset1_id","asset2_id","timeframe","period");--> statement-breakpoint
CREATE INDEX "market_correlation_asset1_idx" ON "market_correlation" USING btree ("asset1_id");--> statement-breakpoint
CREATE INDEX "market_correlation_asset2_idx" ON "market_correlation" USING btree ("asset2_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_indicator_unique_idx" ON "market_indicator" USING btree ("asset_id","timeframe","indicator_type","timestamp");--> statement-breakpoint
CREATE INDEX "market_indicator_asset_idx" ON "market_indicator" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "market_indicator_type_idx" ON "market_indicator" USING btree ("indicator_type");--> statement-breakpoint
CREATE INDEX "market_indicator_timestamp_idx" ON "market_indicator" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "market_opportunity_asset_idx" ON "market_opportunity" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "market_opportunity_type_idx" ON "market_opportunity" USING btree ("type");--> statement-breakpoint
CREATE INDEX "market_opportunity_score_idx" ON "market_opportunity" USING btree ("score");--> statement-breakpoint
CREATE INDEX "market_opportunity_active_idx" ON "market_opportunity" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "market_trend_asset_idx" ON "market_trend" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "market_trend_type_idx" ON "market_trend" USING btree ("trend_type");--> statement-breakpoint
CREATE INDEX "market_trend_active_idx" ON "market_trend" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "market_trend_start_date_idx" ON "market_trend" USING btree ("start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "news_tag_normalized_idx" ON "news_tag" USING btree ("normalized_name","type");--> statement-breakpoint
CREATE INDEX "news_tag_type_idx" ON "news_tag" USING btree ("type");--> statement-breakpoint
CREATE INDEX "news_tag_mentions_idx" ON "news_tag" USING btree ("total_mentions");--> statement-breakpoint
CREATE INDEX "news_tag_last_seen_idx" ON "news_tag" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "tag_mention_tag_idx" ON "tag_mention" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "tag_mention_article_idx" ON "tag_mention" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "tag_mention_sentiment_idx" ON "tag_mention" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "tag_mention_created_idx" ON "tag_mention" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_mention_unique" ON "tag_mention" USING btree ("tag_id","article_id");--> statement-breakpoint
CREATE INDEX "tag_relation_source_idx" ON "tag_relation" USING btree ("source_tag_id");--> statement-breakpoint
CREATE INDEX "tag_relation_target_idx" ON "tag_relation" USING btree ("target_tag_id");--> statement-breakpoint
CREATE INDEX "tag_relation_type_idx" ON "tag_relation" USING btree ("relation_type");--> statement-breakpoint
CREATE INDEX "tag_relation_strength_idx" ON "tag_relation" USING btree ("strength");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_relation_unique" ON "tag_relation" USING btree ("source_tag_id","target_tag_id","relation_type");--> statement-breakpoint
CREATE INDEX "trend_alert_tag_idx" ON "trend_alert" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "trend_alert_type_idx" ON "trend_alert" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "trend_alert_severity_idx" ON "trend_alert" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "trend_alert_created_idx" ON "trend_alert" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "trend_alert_acknowledged_idx" ON "trend_alert" USING btree ("acknowledged");--> statement-breakpoint
CREATE INDEX "trend_snapshot_tag_idx" ON "trend_snapshot" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "trend_snapshot_period_idx" ON "trend_snapshot" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "trend_snapshot_type_idx" ON "trend_snapshot" USING btree ("period_type");--> statement-breakpoint
CREATE INDEX "trend_snapshot_velocity_idx" ON "trend_snapshot" USING btree ("velocity_change");--> statement-breakpoint
CREATE UNIQUE INDEX "trend_snapshot_unique" ON "trend_snapshot" USING btree ("tag_id","period_start","period_type");