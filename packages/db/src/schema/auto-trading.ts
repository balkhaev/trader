import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { exchangeAccount } from "./exchange";

// Auto-trading configuration for users
export const autoTradingConfig = pgTable(
  "auto_trading_config",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    // General settings
    enabled: boolean("enabled").default(false).notNull(),
    exchangeAccountId: text("exchange_account_id").references(
      () => exchangeAccount.id,
      { onDelete: "set null" }
    ),
    // Signal filters
    minSignalStrength: numeric("min_signal_strength", {
      precision: 5,
      scale: 2,
    }).default("75"),
    allowedSources: jsonb("allowed_sources").$type<string[]>().default(["llm"]),
    allowedSymbols: jsonb("allowed_symbols").$type<string[]>(),
    blockedSymbols: jsonb("blocked_symbols").$type<string[]>(),
    allowLong: boolean("allow_long").default(true).notNull(),
    allowShort: boolean("allow_short").default(true).notNull(),
    // Position sizing
    positionSizeType: text("position_size_type").default("fixed").notNull(), // 'fixed' | 'percent' | 'risk_based'
    positionSizeValue: numeric("position_size_value", {
      precision: 20,
      scale: 8,
    }).default("100"), // USD for fixed, % for percent
    maxPositionSize: numeric("max_position_size", {
      precision: 20,
      scale: 8,
    }).default("1000"),
    // Risk management
    defaultStopLossPercent: numeric("default_stop_loss_percent", {
      precision: 5,
      scale: 2,
    }).default("5"),
    defaultTakeProfitPercent: numeric("default_take_profit_percent", {
      precision: 5,
      scale: 2,
    }).default("10"),
    maxDailyTrades: numeric("max_daily_trades", {
      precision: 5,
      scale: 0,
    }).default("10"),
    maxOpenPositions: numeric("max_open_positions", {
      precision: 5,
      scale: 0,
    }).default("5"),
    maxDailyLossPercent: numeric("max_daily_loss_percent", {
      precision: 5,
      scale: 2,
    }).default("5"),
    // Execution
    orderType: text("order_type").default("market").notNull(), // 'market' | 'limit'
    useStopLoss: boolean("use_stop_loss").default(true).notNull(),
    useTakeProfit: boolean("use_take_profit").default(true).notNull(),
    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auto_trading_config_user_idx").on(table.userId)]
);

// Auto-trading execution log
export const autoTradingLog = pgTable(
  "auto_trading_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    signalId: text("signal_id"),
    action: text("action").notNull(), // 'executed' | 'skipped' | 'error'
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("auto_trading_log_user_idx").on(table.userId),
    index("auto_trading_log_created_at_idx").on(table.createdAt),
  ]
);

// Relations
export const autoTradingConfigRelations = relations(
  autoTradingConfig,
  ({ one }) => ({
    user: one(user, {
      fields: [autoTradingConfig.userId],
      references: [user.id],
    }),
    exchangeAccount: one(exchangeAccount, {
      fields: [autoTradingConfig.exchangeAccountId],
      references: [exchangeAccount.id],
    }),
  })
);

export const autoTradingLogRelations = relations(autoTradingLog, ({ one }) => ({
  user: one(user, {
    fields: [autoTradingLog.userId],
    references: [user.id],
  }),
}));
