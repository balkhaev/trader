import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { signal } from "./exchange";

// Enum типов источников
export const newsSourceTypeEnum = pgEnum("news_source_type", [
  "rss",
  "api",
  "twitter",
  "telegram",
  "web_scraper",
]);

// Enum категорий новостей
export const newsCategoryEnum = pgEnum("news_category", [
  "crypto",
  "stocks",
  "forex",
  "commodities",
  "macro",
  "regulation",
  "technology",
  "other",
]);

// Enum статуса анализа
export const analysisStatusEnum = pgEnum("analysis_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// Enum сентимента
export const sentimentEnum = pgEnum("sentiment", [
  "very_bullish",
  "bullish",
  "neutral",
  "bearish",
  "very_bearish",
]);

// Enum типов тегов
export const tagTypeEnum = pgEnum("tag_type", [
  "entity",
  "topic",
  "event",
  "region",
]);

// Enum подтипов сущностей
export const entitySubtypeEnum = pgEnum("entity_subtype", [
  "person",
  "company",
  "crypto",
  "organization",
  "protocol",
  "exchange",
]);

// Enum категорий топиков
export const topicCategoryEnum = pgEnum("topic_category", [
  "regulation",
  "defi",
  "nft",
  "macro",
  "security",
  "adoption",
  "technology",
  "market",
  "governance",
]);

// Enum типов событий
export const eventTypeEnum = pgEnum("event_type", [
  "hack",
  "listing",
  "delisting",
  "lawsuit",
  "announcement",
  "partnership",
  "acquisition",
  "funding",
  "launch",
  "upgrade",
  "bankruptcy",
]);

// Enum типов связей между тегами
export const relationTypeEnum = pgEnum("relation_type", [
  "co_occurrence",
  "causal",
  "temporal",
  "hierarchical",
  "competitive",
  "partnership",
]);

// Источники новостей
export const newsSource = pgTable(
  "news_source",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: newsSourceTypeEnum("type").notNull(),
    url: text("url").notNull(),
    apiKey: text("api_key"), // encrypted
    category: newsCategoryEnum("category").default("crypto").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    fetchInterval: numeric("fetch_interval").default("300").notNull(), // секунды
    lastFetchedAt: timestamp("last_fetched_at"),
    config: jsonb("config").$type<{
      // Общие
      accounts?: string[];
      keywords?: string[];
      language?: string;
      maxAge?: number;
      // Для web_scraper
      newsListSelector?: string;
      articleLinkSelector?: string;
      titleSelector?: string;
      contentSelector?: string;
      dateSelector?: string;
      authorSelector?: string;
      imageSelector?: string;
      summarySelector?: string;
      watchInterval?: number;
      waitForSelector?: string;
      // Для telegram
      channelUsername?: string;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("news_source_user_idx").on(table.userId),
    index("news_source_type_idx").on(table.type),
    index("news_source_enabled_idx").on(table.enabled),
  ]
);

// Новостные статьи
export const newsArticle = pgTable(
  "news_article",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id")
      .notNull()
      .references(() => newsSource.id, { onDelete: "cascade" }),
    externalId: text("external_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    summary: text("summary"),
    author: text("author"),
    imageUrl: text("image_url"),
    category: newsCategoryEnum("category"),
    tags: jsonb("tags").$type<string[]>(),
    symbols: jsonb("symbols").$type<string[]>(),
    publishedAt: timestamp("published_at").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
    language: text("language").default("en"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("news_article_source_idx").on(table.sourceId),
    index("news_article_published_idx").on(table.publishedAt),
    index("news_article_category_idx").on(table.category),
    uniqueIndex("news_article_external_idx").on(
      table.sourceId,
      table.externalId
    ),
  ]
);

// Анализ новостей через LLM
export const newsAnalysis = pgTable(
  "news_analysis",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    articleId: text("article_id")
      .notNull()
      .references(() => newsArticle.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    status: analysisStatusEnum("status").default("pending").notNull(),

    // Результаты анализа
    sentiment: sentimentEnum("sentiment"),
    sentimentScore: numeric("sentiment_score", { precision: 5, scale: 4 }), // -1 to 1
    relevanceScore: numeric("relevance_score", { precision: 5, scale: 4 }), // 0 to 1
    impactScore: numeric("impact_score", { precision: 5, scale: 4 }), // 0 to 1

    // Извлеченные данные
    affectedAssets:
      jsonb("affected_assets").$type<
        {
          symbol: string;
          impact: "positive" | "negative" | "neutral";
          confidence: number;
        }[]
      >(),
    keyPoints: jsonb("key_points").$type<string[]>(),
    marketImplications: text("market_implications"),

    // Рекомендации
    recommendation: jsonb("recommendation").$type<{
      action: "buy" | "sell" | "hold" | "monitor";
      symbols: string[];
      reasoning: string;
      timeframe: "immediate" | "short" | "medium" | "long";
      confidence: number;
      risks: string[];
    }>(),

    // Метаданные LLM
    model: text("model"),
    promptTokens: numeric("prompt_tokens"),
    completionTokens: numeric("completion_tokens"),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),

    error: text("error"),
    analyzedAt: timestamp("analyzed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("news_analysis_article_idx").on(table.articleId),
    index("news_analysis_status_idx").on(table.status),
    index("news_analysis_sentiment_idx").on(table.sentiment),
  ]
);

// Связь сигнала с анализом новости
export const signalNewsLink = pgTable(
  "signal_news_link",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    signalId: text("signal_id")
      .notNull()
      .references(() => signal.id, { onDelete: "cascade" }),
    analysisId: text("analysis_id")
      .notNull()
      .references(() => newsAnalysis.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("signal_news_link_signal_idx").on(table.signalId),
    index("signal_news_link_analysis_idx").on(table.analysisId),
    uniqueIndex("signal_news_link_unique").on(table.signalId, table.analysisId),
  ]
);

// ==================== TRENDS SYSTEM ====================

// Типы для метаданных тегов
export type TagMetadata = {
  description?: string;
  wikipediaUrl?: string;
  websiteUrl?: string;
  logoUrl?: string;
  marketCap?: number;
  foundedYear?: number;
  headquarters?: string;
};

// Справочник нормализованных тегов
export const newsTag = pgTable(
  "news_tag",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(), // lowercase, без спецсимволов
    type: tagTypeEnum("type").notNull(),
    subtype: text("subtype"), // entity_subtype, topic_category, event_type в зависимости от type
    aliases: jsonb("aliases").$type<string[]>().default([]),
    metadata: jsonb("metadata").$type<TagMetadata>(),
    // Агрегированные метрики (обновляются периодически)
    totalMentions: numeric("total_mentions").default("0"),
    avgSentiment: numeric("avg_sentiment", { precision: 5, scale: 4 }),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("news_tag_normalized_idx").on(table.normalizedName, table.type),
    index("news_tag_type_idx").on(table.type),
    index("news_tag_mentions_idx").on(table.totalMentions),
    index("news_tag_last_seen_idx").on(table.lastSeenAt),
  ]
);

// Упоминание тега в статье
export const tagMention = pgTable(
  "tag_mention",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tagId: text("tag_id")
      .notNull()
      .references(() => newsTag.id, { onDelete: "cascade" }),
    articleId: text("article_id")
      .notNull()
      .references(() => newsArticle.id, { onDelete: "cascade" }),
    analysisId: text("analysis_id").references(() => newsAnalysis.id, {
      onDelete: "set null",
    }),
    // Контекст упоминания
    sentiment: sentimentEnum("sentiment"),
    sentimentScore: numeric("sentiment_score", { precision: 5, scale: 4 }), // -1 to 1
    relevance: numeric("relevance", { precision: 5, scale: 4 }).notNull(), // 0 to 1
    context: text("context"), // Извлечённая фраза с упоминанием
    // Дополнительные данные для событий
    eventDate: timestamp("event_date"),
    severity: numeric("severity", { precision: 3, scale: 2 }), // 0 to 1 для событий
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("tag_mention_tag_idx").on(table.tagId),
    index("tag_mention_article_idx").on(table.articleId),
    index("tag_mention_sentiment_idx").on(table.sentiment),
    index("tag_mention_created_idx").on(table.createdAt),
    uniqueIndex("tag_mention_unique").on(table.tagId, table.articleId),
  ]
);

// Связи между тегами (граф)
export const tagRelation = pgTable(
  "tag_relation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    sourceTagId: text("source_tag_id")
      .notNull()
      .references(() => newsTag.id, { onDelete: "cascade" }),
    targetTagId: text("target_tag_id")
      .notNull()
      .references(() => newsTag.id, { onDelete: "cascade" }),
    relationType: relationTypeEnum("relation_type").notNull(),
    // Метрики связи
    strength: numeric("strength", { precision: 5, scale: 4 }).notNull(), // 0 to 1
    coOccurrenceCount: numeric("co_occurrence_count").default("0"),
    avgSentimentDelta: numeric("avg_sentiment_delta", {
      precision: 5,
      scale: 4,
    }), // разница sentiment при совместном появлении
    // Метаданные
    metadata: jsonb("metadata").$type<{
      firstSeen?: string;
      lastSeen?: string;
      examples?: string[]; // примеры статей
      causalDirection?: "forward" | "backward" | "bidirectional";
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tag_relation_source_idx").on(table.sourceTagId),
    index("tag_relation_target_idx").on(table.targetTagId),
    index("tag_relation_type_idx").on(table.relationType),
    index("tag_relation_strength_idx").on(table.strength),
    uniqueIndex("tag_relation_unique").on(
      table.sourceTagId,
      table.targetTagId,
      table.relationType
    ),
  ]
);

// Снимки трендов (для анализа динамики)
export const trendSnapshot = pgTable(
  "trend_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tagId: text("tag_id")
      .notNull()
      .references(() => newsTag.id, { onDelete: "cascade" }),
    // Временное окно
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    periodType: text("period_type").notNull(), // "1h", "24h", "7d"
    // Метрики за период
    mentionCount: numeric("mention_count").notNull(),
    uniqueArticles: numeric("unique_articles").notNull(),
    uniqueSources: numeric("unique_sources").notNull(),
    avgSentiment: numeric("avg_sentiment", { precision: 5, scale: 4 }),
    avgRelevance: numeric("avg_relevance", { precision: 5, scale: 4 }),
    // Динамика
    velocityChange: numeric("velocity_change", { precision: 7, scale: 4 }), // % изменения относительно предыдущего периода
    accelerationChange: numeric("acceleration_change", {
      precision: 7,
      scale: 4,
    }), // изменение скорости изменения
    // Связанные данные
    relatedTags:
      jsonb("related_tags").$type<
        { tagId: string; name: string; coOccurrences: number }[]
      >(),
    topArticles:
      jsonb("top_articles").$type<
        { articleId: string; title: string; relevance: number }[]
      >(),
    sentimentDistribution: jsonb("sentiment_distribution").$type<{
      very_bullish: number;
      bullish: number;
      neutral: number;
      bearish: number;
      very_bearish: number;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("trend_snapshot_tag_idx").on(table.tagId),
    index("trend_snapshot_period_idx").on(table.periodStart, table.periodEnd),
    index("trend_snapshot_type_idx").on(table.periodType),
    index("trend_snapshot_velocity_idx").on(table.velocityChange),
    uniqueIndex("trend_snapshot_unique").on(
      table.tagId,
      table.periodStart,
      table.periodType
    ),
  ]
);

// Алерты трендов (для realtime мониторинга)
export const trendAlert = pgTable(
  "trend_alert",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tagId: text("tag_id")
      .notNull()
      .references(() => newsTag.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(), // "spike", "sentiment_shift", "new_entity", "anomaly"
    severity: text("severity").notNull(), // "low", "medium", "high", "critical"
    // Данные алерта
    title: text("title").notNull(),
    description: text("description"),
    metrics: jsonb("metrics").$type<{
      previousValue?: number;
      currentValue?: number;
      changePercent?: number;
      threshold?: number;
    }>(),
    relatedArticles: jsonb("related_articles").$type<string[]>(),
    // Статус
    acknowledged: boolean("acknowledged").default(false),
    acknowledgedAt: timestamp("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("trend_alert_tag_idx").on(table.tagId),
    index("trend_alert_type_idx").on(table.alertType),
    index("trend_alert_severity_idx").on(table.severity),
    index("trend_alert_created_idx").on(table.createdAt),
    index("trend_alert_acknowledged_idx").on(table.acknowledged),
  ]
);

// Relations
export const newsSourceRelations = relations(newsSource, ({ one, many }) => ({
  user: one(user, {
    fields: [newsSource.userId],
    references: [user.id],
  }),
  articles: many(newsArticle),
}));

export const newsArticleRelations = relations(newsArticle, ({ one, many }) => ({
  source: one(newsSource, {
    fields: [newsArticle.sourceId],
    references: [newsSource.id],
  }),
  analyses: many(newsAnalysis),
  tagMentions: many(tagMention),
}));

export const newsAnalysisRelations = relations(
  newsAnalysis,
  ({ one, many }) => ({
    article: one(newsArticle, {
      fields: [newsAnalysis.articleId],
      references: [newsArticle.id],
    }),
    user: one(user, {
      fields: [newsAnalysis.userId],
      references: [user.id],
    }),
    signalLinks: many(signalNewsLink),
    tagMentions: many(tagMention),
  })
);

export const signalNewsLinkRelations = relations(signalNewsLink, ({ one }) => ({
  signal: one(signal, {
    fields: [signalNewsLink.signalId],
    references: [signal.id],
  }),
  analysis: one(newsAnalysis, {
    fields: [signalNewsLink.analysisId],
    references: [newsAnalysis.id],
  }),
}));

// ==================== TRENDS RELATIONS ====================

export const newsTagRelations = relations(newsTag, ({ many }) => ({
  mentions: many(tagMention),
  sourceRelations: many(tagRelation, { relationName: "sourceTag" }),
  targetRelations: many(tagRelation, { relationName: "targetTag" }),
  snapshots: many(trendSnapshot),
  alerts: many(trendAlert),
}));

export const tagMentionRelations = relations(tagMention, ({ one }) => ({
  tag: one(newsTag, {
    fields: [tagMention.tagId],
    references: [newsTag.id],
  }),
  article: one(newsArticle, {
    fields: [tagMention.articleId],
    references: [newsArticle.id],
  }),
  analysis: one(newsAnalysis, {
    fields: [tagMention.analysisId],
    references: [newsAnalysis.id],
  }),
}));

export const tagRelationRelations = relations(tagRelation, ({ one }) => ({
  sourceTag: one(newsTag, {
    fields: [tagRelation.sourceTagId],
    references: [newsTag.id],
    relationName: "sourceTag",
  }),
  targetTag: one(newsTag, {
    fields: [tagRelation.targetTagId],
    references: [newsTag.id],
    relationName: "targetTag",
  }),
}));

export const trendSnapshotRelations = relations(trendSnapshot, ({ one }) => ({
  tag: one(newsTag, {
    fields: [trendSnapshot.tagId],
    references: [newsTag.id],
  }),
}));

export const trendAlertRelations = relations(trendAlert, ({ one }) => ({
  tag: one(newsTag, {
    fields: [trendAlert.tagId],
    references: [newsTag.id],
  }),
  acknowledgedByUser: one(user, {
    fields: [trendAlert.acknowledgedBy],
    references: [user.id],
  }),
}));
