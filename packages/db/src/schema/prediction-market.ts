import { relations } from "drizzle-orm";
import {
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
import { agent } from "./agent";
import { user } from "./auth";
import { newsArticle } from "./news";

// ==================== ENUMS ====================

export const predictionMarketCategoryEnum = pgEnum(
  "prediction_market_category",
  ["macro", "crypto", "corporate", "geo", "commodity", "other"]
);

export const marketStatusEnum = pgEnum("market_status", [
  "pending", // Awaiting moderation
  "active", // Open for trading
  "paused", // Temporarily paused
  "resolved", // Outcome determined
  "cancelled", // Cancelled/voided
]);

export const marketOutcomeEnum = pgEnum("market_outcome", [
  "yes",
  "no",
  "cancelled",
]);

export const creationTypeEnum = pgEnum("creation_type", [
  "ai",
  "user",
  "system",
]);

export const marketPositionSideEnum = pgEnum("market_position_side", [
  "yes",
  "no",
]);

export const predictionVectorStatusEnum = pgEnum("prediction_vector_status", [
  "pending", // Awaiting check
  "checked", // Verified by system
  "resolved", // Outcome determined
]);

// ==================== TYPES ====================

export type ResolutionCriteria = {
  type: "price" | "date" | "event" | "announcement" | "manual";
  description: string;
  source?: string;
  targetValue?: number;
  targetDate?: string;
};

// ==================== TABLES ====================

// Prediction Markets
export const predictionMarket = pgTable(
  "prediction_market",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Question
    question: text("question").notNull(),
    description: text("description"),
    category: predictionMarketCategoryEnum("category").notNull(),

    // Source
    sourceArticleId: text("source_article_id").references(
      () => newsArticle.id,
      {
        onDelete: "set null",
      }
    ),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    creationType: creationTypeEnum("creation_type").notNull().default("ai"),

    // Pricing (LMSR-based)
    yesPrice: numeric("yes_price", { precision: 5, scale: 2 })
      .notNull()
      .default("50"),
    liquidity: numeric("liquidity", { precision: 20, scale: 8 })
      .notNull()
      .default("1000"),

    // Volume
    totalVolume: numeric("total_volume", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
    yesShares: numeric("yes_shares", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),
    noShares: numeric("no_shares", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),

    // Resolution
    resolutionCriteria: jsonb("resolution_criteria")
      .$type<ResolutionCriteria>()
      .notNull(),
    resolutionSource: text("resolution_source"),
    resolvesAt: timestamp("resolves_at").notNull(),
    resolvedAt: timestamp("resolved_at"),
    outcome: marketOutcomeEnum("outcome"),
    resolutionNotes: text("resolution_notes"),

    // Status
    status: marketStatusEnum("status").notNull().default("pending"),

    // Related data
    relatedSymbols: jsonb("related_symbols").$type<string[]>().default([]),
    tags: jsonb("tags").$type<string[]>().default([]),

    // Metadata
    metadata: jsonb("metadata").$type<{
      aiConfidence?: number;
      generationPrompt?: string;
      originalHeadline?: string;
    }>(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("prediction_market_category_idx").on(table.category),
    index("prediction_market_status_idx").on(table.status),
    index("prediction_market_resolves_at_idx").on(table.resolvesAt),
    index("prediction_market_volume_idx").on(table.totalVolume),
    index("prediction_market_created_at_idx").on(table.createdAt),
    index("prediction_market_source_article_idx").on(table.sourceArticleId),
  ]
);

// Позиции в markets
export const marketPosition = pgTable(
  "market_position",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    marketId: text("market_id")
      .notNull()
      .references(() => predictionMarket.id, { onDelete: "cascade" }),

    // Owner (user or agent)
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),

    // Position
    side: marketPositionSideEnum("side").notNull(),
    shares: numeric("shares", { precision: 20, scale: 8 }).notNull(),
    avgPrice: numeric("avg_price", { precision: 5, scale: 2 }).notNull(),
    totalCost: numeric("total_cost", { precision: 20, scale: 8 }).notNull(),

    // PnL (calculated on resolution)
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("market_position_unique_idx").on(
      table.marketId,
      table.userId,
      table.side
    ),
    index("market_position_market_idx").on(table.marketId),
    index("market_position_user_idx").on(table.userId),
    index("market_position_agent_idx").on(table.agentId),
  ]
);

// История сделок
export const marketTrade = pgTable(
  "market_trade",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    marketId: text("market_id")
      .notNull()
      .references(() => predictionMarket.id, { onDelete: "cascade" }),

    // Trader
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agent.id, {
      onDelete: "set null",
    }),

    // Trade details
    side: marketPositionSideEnum("side").notNull(),
    action: text("action").notNull(), // "buy" | "sell"
    shares: numeric("shares", { precision: 20, scale: 8 }).notNull(),
    price: numeric("price", { precision: 5, scale: 2 }).notNull(),
    cost: numeric("cost", { precision: 20, scale: 8 }).notNull(),

    // Price impact
    priceBeforeTrade: numeric("price_before_trade", {
      precision: 5,
      scale: 2,
    }).notNull(),
    priceAfterTrade: numeric("price_after_trade", {
      precision: 5,
      scale: 2,
    }).notNull(),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("market_trade_market_idx").on(table.marketId),
    index("market_trade_user_idx").on(table.userId),
    index("market_trade_agent_idx").on(table.agentId),
    index("market_trade_created_at_idx").on(table.createdAt),
  ]
);

// Prediction Vectors - AI agent predictions
export const predictionVector = pgTable(
  "prediction_vector",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // References
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    marketId: text("market_id")
      .notNull()
      .references(() => predictionMarket.id, { onDelete: "cascade" }),

    // Prediction
    prediction: marketPositionSideEnum("prediction").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }).notNull(), // 0.00 to 1.00
    reasoning: text("reasoning"),

    // Status tracking
    status: predictionVectorStatusEnum("status").notNull().default("pending"),
    checkCount: integer("check_count").notNull().default(0),

    // Accuracy (calculated after resolution)
    accuracy: numeric("accuracy", { precision: 3, scale: 2 }), // 0.00 to 1.00, null until resolved

    // Timestamps
    predictedAt: timestamp("predicted_at").defaultNow().notNull(),
    checkedAt: timestamp("checked_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("prediction_vector_agent_idx").on(table.agentId),
    index("prediction_vector_market_idx").on(table.marketId),
    index("prediction_vector_status_idx").on(table.status),
    index("prediction_vector_predicted_at_idx").on(table.predictedAt),
  ]
);

// ==================== RELATIONS ====================

export const predictionMarketRelations = relations(
  predictionMarket,
  ({ one, many }) => ({
    sourceArticle: one(newsArticle, {
      fields: [predictionMarket.sourceArticleId],
      references: [newsArticle.id],
    }),
    creator: one(user, {
      fields: [predictionMarket.createdBy],
      references: [user.id],
    }),
    positions: many(marketPosition),
    trades: many(marketTrade),
    vectors: many(predictionVector),
  })
);

export const marketPositionRelations = relations(marketPosition, ({ one }) => ({
  market: one(predictionMarket, {
    fields: [marketPosition.marketId],
    references: [predictionMarket.id],
  }),
  user: one(user, {
    fields: [marketPosition.userId],
    references: [user.id],
  }),
  agent: one(agent, {
    fields: [marketPosition.agentId],
    references: [agent.id],
  }),
}));

export const marketTradeRelations = relations(marketTrade, ({ one }) => ({
  market: one(predictionMarket, {
    fields: [marketTrade.marketId],
    references: [predictionMarket.id],
  }),
  user: one(user, {
    fields: [marketTrade.userId],
    references: [user.id],
  }),
  agent: one(agent, {
    fields: [marketTrade.agentId],
    references: [agent.id],
  }),
}));

export const predictionVectorRelations = relations(
  predictionVector,
  ({ one }) => ({
    agent: one(agent, {
      fields: [predictionVector.agentId],
      references: [agent.id],
    }),
    market: one(predictionMarket, {
      fields: [predictionVector.marketId],
      references: [predictionMarket.id],
    }),
  })
);
