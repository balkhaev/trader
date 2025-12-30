import { relations } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const polymarketEvent = pgTable(
  "polymarket_event",
  {
    id: text("id").primaryKey(),
    ticker: text("ticker"),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    startDate: timestamp("start_date"),
    endDate: timestamp("end_date"),
    image: text("image"),
    active: boolean("active").default(true).notNull(),
    closed: boolean("closed").default(false).notNull(),
    liquidity: doublePrecision("liquidity"),
    volume: doublePrecision("volume"),
    volume24hr: doublePrecision("volume_24hr"),
    openInterest: doublePrecision("open_interest"),
    tags: jsonb("tags").$type<{ id: string; slug: string; label: string }[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("polymarket_event_slug_idx").on(table.slug),
    index("polymarket_event_active_idx").on(table.active),
    index("polymarket_event_closed_idx").on(table.closed),
    index("polymarket_event_volume_idx").on(table.volume),
  ]
);

export const polymarketMarket = pgTable(
  "polymarket_market",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => polymarketEvent.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    slug: text("slug"),
    description: text("description"),
    outcomes: jsonb("outcomes").$type<string[]>(),
    outcomePrices: jsonb("outcome_prices").$type<string[]>(),
    volume: doublePrecision("volume"),
    volume24hr: doublePrecision("volume_24hr"),
    liquidity: doublePrecision("liquidity"),
    bestBid: doublePrecision("best_bid"),
    bestAsk: doublePrecision("best_ask"),
    lastTradePrice: doublePrecision("last_trade_price"),
    spread: doublePrecision("spread"),
    active: boolean("active").default(true).notNull(),
    closed: boolean("closed").default(false).notNull(),
    conditionId: text("condition_id"),
    clobTokenIds: jsonb("clob_token_ids").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("polymarket_market_event_id_idx").on(table.eventId),
    index("polymarket_market_active_idx").on(table.active),
    index("polymarket_market_volume_idx").on(table.volume),
  ]
);

export const polymarketEventRelations = relations(
  polymarketEvent,
  ({ many }) => ({
    markets: many(polymarketMarket),
  })
);

export const polymarketMarketRelations = relations(
  polymarketMarket,
  ({ one }) => ({
    event: one(polymarketEvent, {
      fields: [polymarketMarket.eventId],
      references: [polymarketEvent.id],
    }),
  })
);

// Снимки вероятностей для отслеживания динамики
export const polymarketProbabilitySnapshot = pgTable(
  "polymarket_probability_snapshot",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id")
      .notNull()
      .references(() => polymarketMarket.id, { onDelete: "cascade" }),
    probability: doublePrecision("probability").notNull(),
    volume24h: doublePrecision("volume_24h"),
    liquidity: doublePrecision("liquidity"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (table) => [
    index("pm_snapshot_market_idx").on(table.marketId),
    index("pm_snapshot_timestamp_idx").on(table.timestamp),
  ]
);

// Связь событий с криптоактивами
export const polymarketAssetMapping = pgTable(
  "polymarket_asset_mapping",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references(() => polymarketEvent.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(), // BTC, ETH, etc.
    relevance: doublePrecision("relevance").notNull(), // 0-1
    impactDirection: text("impact_direction").$type<
      "positive" | "negative" | "mixed"
    >(),
    autoDetected: boolean("auto_detected").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pm_asset_mapping_event_idx").on(table.eventId),
    index("pm_asset_mapping_symbol_idx").on(table.symbol),
  ]
);

// Комментарии к событиям
export const polymarketComment = pgTable(
  "polymarket_comment",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => polymarketEvent.id, { onDelete: "cascade" }),
    marketId: text("market_id").references(() => polymarketMarket.id, {
      onDelete: "cascade",
    }),
    userAddress: text("user_address"),
    content: text("content").notNull(),
    parentId: text("parent_id"),
    reactions: jsonb("reactions").$type<{ likes: number; dislikes: number }>(),
    createdAt: timestamp("created_at").notNull(),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    index("pm_comment_event_idx").on(table.eventId),
    index("pm_comment_market_idx").on(table.marketId),
    index("pm_comment_created_idx").on(table.createdAt),
  ]
);

// Top holders маркетов (smart money)
export const polymarketHolder = pgTable(
  "polymarket_holder",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id")
      .notNull()
      .references(() => polymarketMarket.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull(),
    walletAddress: text("wallet_address").notNull(),
    pseudonym: text("pseudonym"),
    amount: doublePrecision("amount").notNull(),
    rank: text("rank"),
    fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  },
  (table) => [
    index("pm_holder_market_idx").on(table.marketId),
    index("pm_holder_wallet_idx").on(table.walletAddress),
  ]
);

// История цен для детального анализа
export const polymarketPriceHistory = pgTable(
  "polymarket_price_history",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    marketId: text("market_id")
      .notNull()
      .references(() => polymarketMarket.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull(),
    timestamp: timestamp("timestamp").notNull(),
    price: doublePrecision("price").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pm_price_history_market_idx").on(table.marketId),
    index("pm_price_history_timestamp_idx").on(table.timestamp),
  ]
);

// Relations для новых таблиц
export const polymarketProbabilitySnapshotRelations = relations(
  polymarketProbabilitySnapshot,
  ({ one }) => ({
    market: one(polymarketMarket, {
      fields: [polymarketProbabilitySnapshot.marketId],
      references: [polymarketMarket.id],
    }),
  })
);

export const polymarketAssetMappingRelations = relations(
  polymarketAssetMapping,
  ({ one }) => ({
    event: one(polymarketEvent, {
      fields: [polymarketAssetMapping.eventId],
      references: [polymarketEvent.id],
    }),
  })
);

export const polymarketCommentRelations = relations(
  polymarketComment,
  ({ one }) => ({
    event: one(polymarketEvent, {
      fields: [polymarketComment.eventId],
      references: [polymarketEvent.id],
    }),
    market: one(polymarketMarket, {
      fields: [polymarketComment.marketId],
      references: [polymarketMarket.id],
    }),
  })
);

export const polymarketHolderRelations = relations(
  polymarketHolder,
  ({ one }) => ({
    market: one(polymarketMarket, {
      fields: [polymarketHolder.marketId],
      references: [polymarketMarket.id],
    }),
  })
);

export const polymarketPriceHistoryRelations = relations(
  polymarketPriceHistory,
  ({ one }) => ({
    market: one(polymarketMarket, {
      fields: [polymarketPriceHistory.marketId],
      references: [polymarketMarket.id],
    }),
  })
);
