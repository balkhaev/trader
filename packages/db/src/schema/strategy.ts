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

export type StrategyWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type StrategyRiskMode = "base" | "boost" | "stopped";

export interface StrategyExecutionConfig {
  venue: "binance_usdm";
  orderType: "market" | "limit";
  roundTurnCostBps: number;
  maxPositions: number;
  maxGrossLeverage: number;
  skipOvernight: boolean;
  skipFundingCrossing: boolean;
}

export interface WifOiFlushConfig {
  enabled: boolean;
  symbol: "WIFUSDT";
  allowedWeekdaysUtc: StrategyWeekday[];
  move45mAtrMax: number;
  volumeZMin: number;
  lowerWickRatioMin: number;
  closeLocationMin: number;
  takerImbalanceMin: number;
  oiZMax: number;
  strengthMin: number;
  stopAtr: number;
  targetR: number;
  maxHoldMinutes: number;
}

export interface DotFundingConfig {
  enabled: boolean;
  symbol: "DOTUSDT";
  entryDelayMinutes: number;
  weekdayFundingThresholdBps: Partial<Record<StrategyWeekday, number>>;
  stopAtr: number;
  targetR: number;
  maxHoldMinutes: number;
}

export interface RiskAcceleratorConfig {
  baseWifRiskPercent: number;
  baseDotRiskPercent: number;
  boostWifRiskPercent: number;
  boostDotRiskPercent: number;
  boostTriggerProfitPercent: number;
  deRiskDrawdownPercent: number;
  hardStopDrawdownPercent: number;
}

export interface StrategyRuntimeState {
  mode: StrategyRiskMode;
  initialEquity: number;
  equity: number;
  highWaterEquity: number;
  lastDeriskHighWaterEquity: number;
  updatedAt: string;
}

export interface StrategyConfig {
  kind: "consensus_wif_dot_v1";
  name: string;
  description?: string;
  timeframe: "15m";
  execution: StrategyExecutionConfig;
  wif: WifOiFlushConfig;
  dot: DotFundingConfig;
  risk: RiskAcceleratorConfig;
  runtime?: StrategyRuntimeState;
}

export const DEFAULT_CONSENSUS_STRATEGY_CONFIG: StrategyConfig = {
  kind: "consensus_wif_dot_v1",
  name: "Consensus WIF + DOT Risk Accelerator V1",
  description:
    "Long-only Binance USD-M strategy: WIF OI-flush reclaim plus DOT negative-funding rebound with staged risk acceleration.",
  timeframe: "15m",
  execution: {
    venue: "binance_usdm",
    orderType: "market",
    roundTurnCostBps: 20,
    maxPositions: 2,
    maxGrossLeverage: 3,
    skipOvernight: true,
    skipFundingCrossing: true,
  },
  wif: {
    enabled: true,
    symbol: "WIFUSDT",
    // Monday = 0. Consensus route: Tuesday, Friday, Sunday.
    allowedWeekdaysUtc: [1, 4, 6],
    move45mAtrMax: -2,
    volumeZMin: 1,
    lowerWickRatioMin: 0.5,
    closeLocationMin: 0.6,
    takerImbalanceMin: -0.1,
    oiZMax: -1,
    strengthMin: 3.5,
    stopAtr: 1.25,
    targetR: 5,
    maxHoldMinutes: 60,
  },
  dot: {
    enabled: true,
    symbol: "DOTUSDT",
    entryDelayMinutes: 15,
    // Monday/Tuesday <= -2.25 bps; Friday/Saturday/Sunday <= -2.50 bps.
    weekdayFundingThresholdBps: {
      0: -2.25,
      1: -2.25,
      4: -2.5,
      5: -2.5,
      6: -2.5,
    },
    stopAtr: 6,
    targetR: 2,
    maxHoldMinutes: 480,
  },
  risk: {
    baseWifRiskPercent: 3,
    baseDotRiskPercent: 5,
    boostWifRiskPercent: 7.5,
    boostDotRiskPercent: 10,
    boostTriggerProfitPercent: 15,
    deRiskDrawdownPercent: 8,
    hardStopDrawdownPercent: 15,
  },
};

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
    isPublic: boolean("is_public").default(false).notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    leanCode: text("lean_code"),
    lastBacktestId: text("last_backtest_id"),
    backtestCount: text("backtest_count").default("0"),
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

export const strategyRelations = relations(strategy, ({ one }) => ({
  user: one(user, {
    fields: [strategy.userId],
    references: [user.id],
  }),
}));
