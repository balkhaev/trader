import { relations } from "drizzle-orm";
import {
  boolean,
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
import { user } from "./auth";
import { predictionVector } from "./prediction-market";

// ==================== ENUMS ====================

export const agentStatusEnum = pgEnum("agent_status", [
  "backtesting",
  "active",
  "paused",
  "archived",
]);

export const allocationStatusEnum = pgEnum("allocation_status", [
  "active",
  "withdrawn",
]);

export const agentTradeStatusEnum = pgEnum("agent_trade_status", [
  "open",
  "closed",
  "cancelled",
]);

export const agentStrategyTypeEnum = pgEnum("agent_strategy_type", [
  "news",
  "technical",
  "transport",
  "macro",
  "prediction",
  "hybrid",
]);

export const riskLevelEnum = pgEnum("risk_level", ["low", "medium", "high"]);

// ==================== TYPES ====================

export type AgentStrategy = {
  type: "news" | "technical" | "transport" | "macro" | "prediction" | "hybrid";
  description: string;
  dataSources: string[];
  entryRules: Array<{
    condition: string;
    threshold?: number;
    operator?: ">" | "<" | "=" | ">=" | "<=";
  }>;
  exitRules: Array<{
    type: "takeProfit" | "stopLoss" | "trailingStop" | "timeExit" | "signal";
    value: number;
  }>;
  symbols?: string[];
  timeframes?: string[];
};

export type RiskParams = {
  maxPositionSize: number; // % of allocated capital
  maxDrawdown: number; // % before pause
  maxDailyLoss: number; // % daily loss limit
  maxOpenPositions: number;
  minTimeBetweenTrades: number; // seconds
};

// ==================== TABLES ====================

// Агенты
export const agent = pgTable(
  "agent",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Basic info
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    avatarUrl: text("avatar_url"),

    // Strategy
    strategyType: agentStrategyTypeEnum("strategy_type").notNull(),
    strategy: jsonb("strategy").$type<AgentStrategy>().notNull(),
    riskParams: jsonb("risk_params").$type<RiskParams>().notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull().default("medium"),

    // Status
    status: agentStatusEnum("status").notNull().default("backtesting"),
    isPublic: boolean("is_public").notNull().default(false),

    // Performance metrics (updated by scheduler)
    totalReturn: numeric("total_return", { precision: 12, scale: 4 }),
    monthlyReturn: numeric("monthly_return", { precision: 10, scale: 4 }),
    sharpeRatio: numeric("sharpe_ratio", { precision: 8, scale: 4 }),
    maxDrawdown: numeric("max_drawdown", { precision: 8, scale: 4 }),
    winRate: numeric("win_rate", { precision: 6, scale: 4 }),
    totalTrades: integer("total_trades").notNull().default(0),
    avgHoldingPeriodHours: numeric("avg_holding_period_hours", {
      precision: 10,
      scale: 2,
    }),

    // Capital
    totalAllocated: numeric("total_allocated", { precision: 20, scale: 8 })
      .notNull()
      .default("0"),

    // Ownership
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("agent_status_idx").on(table.status),
    index("agent_strategy_type_idx").on(table.strategyType),
    index("agent_public_idx").on(table.isPublic),
    index("agent_total_return_idx").on(table.totalReturn),
    index("agent_created_by_idx").on(table.createdBy),
  ]
);

// Аллокации пользователей в агентов
export const agentAllocation = pgTable(
  "agent_allocation",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Amount
    amount: numeric("amount", { precision: 20, scale: 8 }).notNull(),
    currentValue: numeric("current_value", { precision: 20, scale: 8 }),

    // Status
    status: allocationStatusEnum("status").notNull().default("active"),

    // PnL
    realizedPnl: numeric("realized_pnl", { precision: 20, scale: 8 }),
    unrealizedPnl: numeric("unrealized_pnl", { precision: 20, scale: 8 }),

    // Timestamps
    allocatedAt: timestamp("allocated_at").defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawn_at"),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("agent_allocation_unique_idx").on(table.agentId, table.userId),
    index("agent_allocation_agent_idx").on(table.agentId),
    index("agent_allocation_user_idx").on(table.userId),
    index("agent_allocation_status_idx").on(table.status),
  ]
);

// Сделки агентов
export const agentTrade = pgTable(
  "agent_trade",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),

    // Trade details
    symbol: text("symbol").notNull(),
    side: text("side").notNull(), // "long" | "short"
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),

    // Prices
    entryPrice: numeric("entry_price", { precision: 24, scale: 12 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 24, scale: 12 }),
    stopLoss: numeric("stop_loss", { precision: 24, scale: 12 }),
    takeProfit: numeric("take_profit", { precision: 24, scale: 12 }),

    // Reasoning (LLM explanation)
    reasoning: text("reasoning"),
    dataSources: jsonb("data_sources").$type<{
      news?: { articleId: string; headline: string; sentiment: number }[];
      technical?: { indicator: string; value: number; signal: string }[];
      transport?: { signalId: string; type: string; impact: string }[];
      prediction?: {
        marketId: string;
        question: string;
        probability: number;
      }[];
    }>(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }), // 0-1

    // Status
    status: agentTradeStatusEnum("status").notNull().default("open"),

    // PnL
    pnl: numeric("pnl", { precision: 20, scale: 8 }),
    pnlPercent: numeric("pnl_percent", { precision: 10, scale: 4 }),

    // Timestamps
    openedAt: timestamp("opened_at").defaultNow().notNull(),
    closedAt: timestamp("closed_at"),
  },
  (table) => [
    index("agent_trade_agent_idx").on(table.agentId),
    index("agent_trade_symbol_idx").on(table.symbol),
    index("agent_trade_status_idx").on(table.status),
    index("agent_trade_opened_at_idx").on(table.openedAt),
  ]
);

// ==================== RELATIONS ====================

export const agentRelations = relations(agent, ({ one, many }) => ({
  creator: one(user, {
    fields: [agent.createdBy],
    references: [user.id],
  }),
  allocations: many(agentAllocation),
  trades: many(agentTrade),
  vectors: many(predictionVector),
}));

export const agentAllocationRelations = relations(
  agentAllocation,
  ({ one }) => ({
    agent: one(agent, {
      fields: [agentAllocation.agentId],
      references: [agent.id],
    }),
    user: one(user, {
      fields: [agentAllocation.userId],
      references: [user.id],
    }),
  })
);

export const agentTradeRelations = relations(agentTrade, ({ one }) => ({
  agent: one(agent, {
    fields: [agentTrade.agentId],
    references: [agent.id],
  }),
}));
