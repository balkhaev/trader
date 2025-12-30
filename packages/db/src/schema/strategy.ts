import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Strategy condition types
export interface IndicatorCondition {
  type: "indicator";
  indicator: "rsi" | "macd" | "bollinger" | "sma" | "ema" | "adx" | "atr";
  parameter: string; // e.g., "value", "signal", "histogram"
  period?: number;
  operator: ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";
  value: number | string;
}

export interface PriceCondition {
  type: "price";
  comparison: "close" | "open" | "high" | "low" | "volume";
  operator: ">" | "<" | ">=" | "<=" | "==";
  value: number | string;
}

export interface NewsCondition {
  type: "news";
  sentimentMin?: number;
  sentimentMax?: number;
  keywords?: string[];
  sources?: string[];
}

export interface TransportCondition {
  type: "transport";
  commodity: string;
  signalDirection?: "bullish" | "bearish";
  minStrength?: number;
}

export type StrategyCondition =
  | IndicatorCondition
  | PriceCondition
  | NewsCondition
  | TransportCondition;

export interface StrategyRule {
  id: string;
  name: string;
  conditions: StrategyCondition[];
  conditionLogic: "AND" | "OR"; // How to combine conditions
  action: "long" | "short" | "close_long" | "close_short" | "close_all";
  priority: number;
}

export interface StrategyConfig {
  name: string;
  description?: string;
  symbols: string[];
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  // Entry/Exit rules
  entryRules: StrategyRule[];
  exitRules: StrategyRule[];
  // Risk management
  positionSizePercent: number;
  maxPositions: number;
  defaultStopLossPercent?: number;
  defaultTakeProfitPercent?: number;
  trailingStopPercent?: number;
  // Schedule
  tradingHoursStart?: string; // HH:MM
  tradingHoursEnd?: string;
  tradingDays?: number[]; // 0-6, Sunday = 0
}

// User-created strategies
export const strategy = pgTable(
  "strategy",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    config: jsonb("config").$type<StrategyConfig>().notNull(),
    // Metadata
    isPublic: boolean("is_public").default(false).notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    // Generated code
    leanCode: text("lean_code"),
    lastBacktestId: text("last_backtest_id"),
    // Stats
    backtestCount: text("backtest_count").default("0"),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("strategy_user_idx").on(table.userId),
    index("strategy_public_idx").on(table.isPublic),
  ]
);

// Relations
export const strategyRelations = relations(strategy, ({ one }) => ({
  user: one(user, {
    fields: [strategy.userId],
    references: [user.id],
  }),
}));
