import { relations } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Enum типов рынка
export const marketTypeEnum = pgEnum("market_type", [
  "crypto",
  "etf",
  "stock",
  "moex",
  "forex",
  "commodity",
]);

// Enum источников данных
export const dataSourceEnum = pgEnum("data_source", [
  "binance",
  "bybit",
  "yahoo",
  "alpaca",
  "moex_iss",
  "tinkoff",
]);

// Enum таймфреймов
export const timeframeEnum = pgEnum("timeframe", [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
  "1w",
]);

// Enum типов индикаторов
export const indicatorTypeEnum = pgEnum("indicator_type", [
  "rsi",
  "macd",
  "bollinger",
  "ema",
  "sma",
  "adx",
  "atr",
  "volume_profile",
  "support_resistance",
]);

// Enum типов трендов
export const trendTypeEnum = pgEnum("trend_type", [
  "uptrend",
  "downtrend",
  "sideways",
  "breakout_up",
  "breakout_down",
  "reversal_bullish",
  "reversal_bearish",
]);

// Enum силы тренда
export const trendStrengthEnum = pgEnum("trend_strength", [
  "weak",
  "moderate",
  "strong",
  "very_strong",
]);

// Активы рынка
export const marketAsset = pgTable(
  "market_asset",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    symbol: text("symbol").notNull(),
    name: text("name").notNull(),
    marketType: marketTypeEnum("market_type").notNull(),
    dataSource: dataSourceEnum("data_source").notNull(),
    baseCurrency: text("base_currency"), // BTC, ETH, SPY etc
    quoteCurrency: text("quote_currency"), // USDT, USD etc
    sector: text("sector"), // technology, finance, defi etc
    metadata: jsonb("metadata").$type<{
      exchange?: string;
      contractType?: string;
      marketCap?: number;
      circulatingSupply?: number;
      totalSupply?: number;
      description?: string;
    }>(),
    isActive: text("is_active").default("true").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("market_asset_symbol_source_idx").on(
      table.symbol,
      table.dataSource
    ),
    index("market_asset_market_type_idx").on(table.marketType),
    index("market_asset_sector_idx").on(table.sector),
  ]
);

// OHLCV свечи
export const marketCandle = pgTable(
  "market_candle",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text("asset_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    timeframe: timeframeEnum("timeframe").notNull(),
    openTime: timestamp("open_time").notNull(),
    closeTime: timestamp("close_time").notNull(),
    open: numeric("open", { precision: 24, scale: 12 }).notNull(),
    high: numeric("high", { precision: 24, scale: 12 }).notNull(),
    low: numeric("low", { precision: 24, scale: 12 }).notNull(),
    close: numeric("close", { precision: 24, scale: 12 }).notNull(),
    volume: numeric("volume", { precision: 24, scale: 8 }).notNull(),
    quoteVolume: numeric("quote_volume", { precision: 24, scale: 8 }),
    trades: numeric("trades"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_candle_unique_idx").on(
      table.assetId,
      table.timeframe,
      table.openTime
    ),
    index("market_candle_asset_idx").on(table.assetId),
    index("market_candle_timeframe_idx").on(table.timeframe),
    index("market_candle_open_time_idx").on(table.openTime),
  ]
);

// Рассчитанные индикаторы
export const marketIndicator = pgTable(
  "market_indicator",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text("asset_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    timeframe: timeframeEnum("timeframe").notNull(),
    indicatorType: indicatorTypeEnum("indicator_type").notNull(),
    timestamp: timestamp("timestamp").notNull(),
    value: numeric("value", { precision: 24, scale: 12 }),
    values: jsonb("values").$type<Record<string, unknown>>(),
    params: jsonb("params").$type<{
      period?: number;
      fastPeriod?: number;
      slowPeriod?: number;
      signalPeriod?: number;
      stdDev?: number;
      [key: string]: number | undefined;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_indicator_unique_idx").on(
      table.assetId,
      table.timeframe,
      table.indicatorType,
      table.timestamp
    ),
    index("market_indicator_asset_idx").on(table.assetId),
    index("market_indicator_type_idx").on(table.indicatorType),
    index("market_indicator_timestamp_idx").on(table.timestamp),
  ]
);

// Обнаруженные тренды
export const marketTrend = pgTable(
  "market_trend",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text("asset_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    timeframe: timeframeEnum("timeframe").notNull(),
    trendType: trendTypeEnum("trend_type").notNull(),
    strength: trendStrengthEnum("strength").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(), // 0-1
    startPrice: numeric("start_price", { precision: 24, scale: 12 }).notNull(),
    currentPrice: numeric("current_price", {
      precision: 24,
      scale: 12,
    }).notNull(),
    priceChange: numeric("price_change", { precision: 10, scale: 4 }), // процент
    startDate: timestamp("start_date").notNull(),
    endDate: timestamp("end_date"),
    isActive: text("is_active").default("true").notNull(),
    metadata: jsonb("metadata").$type<{
      supportLevel?: number;
      resistanceLevel?: number;
      volumeConfirmation?: boolean;
      indicatorSignals?: {
        rsi?: "oversold" | "overbought" | "neutral";
        macd?: "bullish" | "bearish" | "neutral";
        adx?: number;
      };
      description?: string;
    }>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("market_trend_asset_idx").on(table.assetId),
    index("market_trend_type_idx").on(table.trendType),
    index("market_trend_active_idx").on(table.isActive),
    index("market_trend_start_date_idx").on(table.startDate),
  ]
);

// Корреляции между активами
export const marketCorrelation = pgTable(
  "market_correlation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    asset1Id: text("asset1_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    asset2Id: text("asset2_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    timeframe: timeframeEnum("timeframe").notNull(),
    period: text("period").notNull(), // "7d", "30d", "90d"
    correlation: numeric("correlation", { precision: 6, scale: 5 }).notNull(), // -1 to 1
    pValue: numeric("p_value", { precision: 10, scale: 8 }),
    sampleSize: numeric("sample_size"),
    calculatedAt: timestamp("calculated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("market_correlation_unique_idx").on(
      table.asset1Id,
      table.asset2Id,
      table.timeframe,
      table.period
    ),
    index("market_correlation_asset1_idx").on(table.asset1Id),
    index("market_correlation_asset2_idx").on(table.asset2Id),
  ]
);

// Возможности для инвестирования
export const marketOpportunity = pgTable(
  "market_opportunity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    assetId: text("asset_id")
      .notNull()
      .references(() => marketAsset.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "trend_following", "mean_reversion", "breakout", "momentum"
    direction: text("direction").notNull(), // "long", "short"
    score: numeric("score", { precision: 5, scale: 2 }).notNull(), // 0-100
    entryPrice: numeric("entry_price", { precision: 24, scale: 12 }),
    targetPrice: numeric("target_price", { precision: 24, scale: 12 }),
    stopLoss: numeric("stop_loss", { precision: 24, scale: 12 }),
    riskRewardRatio: numeric("risk_reward_ratio", { precision: 6, scale: 2 }),
    timeframe: timeframeEnum("timeframe").notNull(),
    reasoning: text("reasoning").notNull(),
    indicators: jsonb("indicators").$type<{
      rsi?: number;
      macd?: { value: number; signal: number; histogram: number };
      adx?: number;
      volumeChange?: number;
      priceChange24h?: number;
    }>(),
    isActive: text("is_active").default("true").notNull(),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("market_opportunity_asset_idx").on(table.assetId),
    index("market_opportunity_type_idx").on(table.type),
    index("market_opportunity_score_idx").on(table.score),
    index("market_opportunity_active_idx").on(table.isActive),
  ]
);

// Relations
export const marketAssetRelations = relations(marketAsset, ({ many }) => ({
  candles: many(marketCandle),
  indicators: many(marketIndicator),
  trends: many(marketTrend),
  opportunities: many(marketOpportunity),
  correlationsAsAsset1: many(marketCorrelation, { relationName: "asset1" }),
  correlationsAsAsset2: many(marketCorrelation, { relationName: "asset2" }),
}));

export const marketCandleRelations = relations(marketCandle, ({ one }) => ({
  asset: one(marketAsset, {
    fields: [marketCandle.assetId],
    references: [marketAsset.id],
  }),
}));

export const marketIndicatorRelations = relations(
  marketIndicator,
  ({ one }) => ({
    asset: one(marketAsset, {
      fields: [marketIndicator.assetId],
      references: [marketAsset.id],
    }),
  })
);

export const marketTrendRelations = relations(marketTrend, ({ one }) => ({
  asset: one(marketAsset, {
    fields: [marketTrend.assetId],
    references: [marketAsset.id],
  }),
}));

export const marketCorrelationRelations = relations(
  marketCorrelation,
  ({ one }) => ({
    asset1: one(marketAsset, {
      fields: [marketCorrelation.asset1Id],
      references: [marketAsset.id],
      relationName: "asset1",
    }),
    asset2: one(marketAsset, {
      fields: [marketCorrelation.asset2Id],
      references: [marketAsset.id],
      relationName: "asset2",
    }),
  })
);

export const marketOpportunityRelations = relations(
  marketOpportunity,
  ({ one }) => ({
    asset: one(marketAsset, {
      fields: [marketOpportunity.assetId],
      references: [marketAsset.id],
    }),
  })
);
