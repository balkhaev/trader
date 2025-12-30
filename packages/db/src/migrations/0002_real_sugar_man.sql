CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."news_category" AS ENUM('crypto', 'stocks', 'forex', 'commodities', 'macro', 'regulation', 'technology', 'other');--> statement-breakpoint
CREATE TYPE "public"."news_source_type" AS ENUM('rss', 'api', 'twitter', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('very_bullish', 'bullish', 'neutral', 'bearish', 'very_bearish');--> statement-breakpoint
ALTER TYPE "public"."signal_source" ADD VALUE 'llm';--> statement-breakpoint
CREATE TABLE "news_analysis" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"user_id" text,
	"status" "analysis_status" DEFAULT 'pending' NOT NULL,
	"sentiment" "sentiment",
	"sentiment_score" numeric(5, 4),
	"relevance_score" numeric(5, 4),
	"impact_score" numeric(5, 4),
	"affected_assets" jsonb,
	"key_points" jsonb,
	"market_implications" text,
	"recommendation" jsonb,
	"model" text,
	"prompt_tokens" numeric,
	"completion_tokens" numeric,
	"raw_response" jsonb,
	"error" text,
	"analyzed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "news_article" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"summary" text,
	"author" text,
	"image_url" text,
	"category" "news_category",
	"tags" jsonb,
	"symbols" jsonb,
	"published_at" timestamp NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"language" text DEFAULT 'en',
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "news_source" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"type" "news_source_type" NOT NULL,
	"url" text NOT NULL,
	"api_key" text,
	"category" "news_category" DEFAULT 'crypto' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"fetch_interval" numeric DEFAULT '300' NOT NULL,
	"last_fetched_at" timestamp,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_news_link" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_analysis" ADD CONSTRAINT "news_analysis_article_id_news_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."news_article"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_analysis" ADD CONSTRAINT "news_analysis_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_article" ADD CONSTRAINT "news_article_source_id_news_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."news_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "news_source" ADD CONSTRAINT "news_source_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_news_link" ADD CONSTRAINT "signal_news_link_signal_id_signal_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_news_link" ADD CONSTRAINT "signal_news_link_analysis_id_news_analysis_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."news_analysis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "news_analysis_article_idx" ON "news_analysis" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "news_analysis_status_idx" ON "news_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "news_analysis_sentiment_idx" ON "news_analysis" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "news_article_source_idx" ON "news_article" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "news_article_published_idx" ON "news_article" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_article_category_idx" ON "news_article" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "news_article_external_idx" ON "news_article" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "news_source_user_idx" ON "news_source" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "news_source_type_idx" ON "news_source" USING btree ("type");--> statement-breakpoint
CREATE INDEX "news_source_enabled_idx" ON "news_source" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "signal_news_link_signal_idx" ON "signal_news_link" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_news_link_analysis_idx" ON "signal_news_link" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_news_link_unique" ON "signal_news_link" USING btree ("signal_id","analysis_id");