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
    enabled: boolean("enabled").default(false).notNull(),
    exchangeAccountId: text("exchange_account_id").references(
      () => exchangeAccount.id,
      { onDelete: "set null" }
    ),
    minSignalStrength: numeric("min_signal_strength", {
      precision: 5,
      scale: 2,
    }).default("0"),
    allowedSources: jsonb("allowed_sources")
      .$type<string[]>()
      .default(["webhook"]),
    allowedSymbols: jsonb("allowed_symbols")
      .$type<string[]>()
      .default(["WIFUSDT", "DOTUSDT"]),
    blockedSymbols: jsonb("blocked_symbols").$type<string[]>(),
    allowLong: boolean("allow_long").default(true).notNull(),
    allowShort: boolean("allow_short").default(false).notNull(),
    positionSizeType: text("position_size_type")
      .default("risk_based")
      .notNull(),
    positionSizeValue: numeric("position_size_value", {
      precision: 20,
      scale: 8,
    }).default("1"),
    maxPositionSize: numeric("max_position_size", {
      precision: 20,
      scale: 8,
    }).default("0"),
    defaultStopLossPercent: numeric("default_stop_loss_percent", {
      precision: 5,
      scale: 2,
    }).default("0"),
    defaultTakeProfitPercent: numeric("default_take_profit_percent", {
      precision: 5,
      scale: 2,
    }).default("0"),
    maxDailyTrades: numeric("max_daily_trades", {
      precision: 5,
      scale: 0,
    }).default("10"),
    maxOpenPositions: numeric("max_open_positions", {
      precision: 5,
      scale: 0,
    }).default("2"),
    maxDailyLossPercent: numeric("max_daily_loss_percent", {
      precision: 5,
      scale: 2,
    }).default("15"),
    orderType: text("order_type").default("market").notNull(),
    useStopLoss: boolean("use_stop_loss").default(true).notNull(),
    useTakeProfit: boolean("use_take_profit").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auto_trading_config_user_idx").on(table.userId)]
);

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
    action: text("action").notNull(),
    reason: text("reason"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("auto_trading_log_user_idx").on(table.userId),
    index("auto_trading_log_created_at_idx").on(table.createdAt),
  ]
);

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
