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
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const exchangeEnum = pgEnum("exchange", ["bybit", "binance", "tinkoff"]);

export const positionSideEnum = pgEnum("position_side", ["long", "short"]);

export const positionStatusEnum = pgEnum("position_status", [
  "open",
  "closed",
  "liquidated",
]);

export const orderTypeEnum = pgEnum("order_type", ["market", "limit"]);

export const signalSourceEnum = pgEnum("signal_source", [
  "backtest",
  "webhook",
  "manual",
  "llm",
]);

export const signalStatusEnum = pgEnum("signal_status", [
  "pending",
  "executed",
  "rejected",
  "expired",
]);

// Аккаунты бирж
export const exchangeAccount = pgTable(
  "exchange_account",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exchange: exchangeEnum("exchange").notNull(),
    name: text("name").notNull(),
    apiKey: text("api_key").notNull(), // encrypted
    apiSecret: text("api_secret").notNull(), // encrypted
    testnet: boolean("testnet").default(false).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("exchange_account_user_idx").on(table.userId),
    index("exchange_account_exchange_idx").on(table.exchange),
  ]
);

// Портфели пользователя
export const portfolio = pgTable(
  "portfolio",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    baseCurrency: text("base_currency").default("USDT").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("portfolio_user_idx").on(table.userId)]
);

// Позиции
export const position = pgTable(
  "position",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id")
      .notNull()
      .references(() => exchangeAccount.id, { onDelete: "cascade" }),
    symbol: text("symbol").notNull(),
    side: positionSideEnum("side").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
    currentPrice: numeric("current_price", { precision: 20, scale: 8 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 8 }),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
    status: positionStatusEnum("status").default("open").notNull(),
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => [
    index("position_user_idx").on(table.userId),
    index("position_exchange_account_idx").on(table.exchangeAccountId),
    index("position_status_idx").on(table.status),
    index("position_symbol_idx").on(table.symbol),
  ]
);

// История сделок
export const trade = pgTable(
  "trade",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    exchangeAccountId: text("exchange_account_id")
      .notNull()
      .references(() => exchangeAccount.id, { onDelete: "cascade" }),
    positionId: text("position_id").references(() => position.id, {
      onDelete: "set null",
    }),
    symbol: text("symbol").notNull(),
    side: positionSideEnum("side").notNull(),
    orderType: orderTypeEnum("order_type").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    price: numeric("price", { precision: 20, scale: 8 }).notNull(),
    commission: numeric("commission", { precision: 20, scale: 8 }),
    externalId: text("external_id"), // ID ордера на бирже
    executedAt: timestamp("executed_at").defaultNow().notNull(),
  },
  (table) => [
    index("trade_user_idx").on(table.userId),
    index("trade_exchange_account_idx").on(table.exchangeAccountId),
    index("trade_symbol_idx").on(table.symbol),
    index("trade_executed_at_idx").on(table.executedAt),
  ]
);

// Торговые сигналы
export const signal = pgTable(
  "signal",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: signalSourceEnum("source").notNull(),
    symbol: text("symbol").notNull(),
    side: positionSideEnum("side").notNull(),
    strength: numeric("strength", { precision: 5, scale: 2 }), // 0-100
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    status: signalStatusEnum("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    executedAt: timestamp("executed_at"),
    // Performance tracking fields
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
    exitAt: timestamp("exit_at"),
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
    holdingPeriodMinutes: numeric("holding_period_minutes", {
      precision: 10,
      scale: 0,
    }),
    isWin: boolean("is_win"),
  },
  (table) => [
    index("signal_user_idx").on(table.userId),
    index("signal_status_idx").on(table.status),
    index("signal_created_at_idx").on(table.createdAt),
  ]
);

// Relations
export const exchangeAccountRelations = relations(
  exchangeAccount,
  ({ one, many }) => ({
    user: one(user, {
      fields: [exchangeAccount.userId],
      references: [user.id],
    }),
    positions: many(position),
    trades: many(trade),
  })
);

export const portfolioRelations = relations(portfolio, ({ one }) => ({
  user: one(user, {
    fields: [portfolio.userId],
    references: [user.id],
  }),
}));

export const positionRelations = relations(position, ({ one, many }) => ({
  user: one(user, {
    fields: [position.userId],
    references: [user.id],
  }),
  exchangeAccount: one(exchangeAccount, {
    fields: [position.exchangeAccountId],
    references: [exchangeAccount.id],
  }),
  trades: many(trade),
}));

export const tradeRelations = relations(trade, ({ one }) => ({
  user: one(user, {
    fields: [trade.userId],
    references: [user.id],
  }),
  exchangeAccount: one(exchangeAccount, {
    fields: [trade.exchangeAccountId],
    references: [exchangeAccount.id],
  }),
  position: one(position, {
    fields: [trade.positionId],
    references: [position.id],
  }),
}));

export const signalRelations = relations(signal, ({ one }) => ({
  user: one(user, {
    fields: [signal.userId],
    references: [user.id],
  }),
}));
