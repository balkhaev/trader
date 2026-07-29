import {
  db,
  DEFAULT_CONSENSUS_STRATEGY_CONFIG,
  strategy,
  type StrategyConfig,
  type StrategyRuntimeState,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, sql } from "drizzle-orm";
import { generateConsensusLeanCode } from "./lean-code";

export type StrategyRecord = InferSelectModel<typeof strategy>;

const consensusKind = sql`${strategy.config}->>'kind' = 'consensus_wif_dot_v1'`;

function cloneConfig(config: StrategyConfig): StrategyConfig {
  return structuredClone(config);
}

function validateConfig(config: StrategyConfig): StrategyConfig {
  for (const [name, value] of Object.entries(config.risk)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`risk.${name} must be a positive finite number`);
    }
  }
  if (config.risk.boostWifRiskPercent < config.risk.baseWifRiskPercent) {
    throw new Error("WIF boost risk cannot be below base risk");
  }
  if (config.risk.boostDotRiskPercent < config.risk.baseDotRiskPercent) {
    throw new Error("DOT boost risk cannot be below base risk");
  }
  if (
    config.risk.deRiskDrawdownPercent >= config.risk.hardStopDrawdownPercent
  ) {
    throw new Error("De-risk drawdown must be below hard-stop drawdown");
  }
  if (
    config.execution.maxGrossLeverage <= 0 ||
    config.execution.maxGrossLeverage > 5
  ) {
    throw new Error("Gross leverage must be in (0, 5]");
  }
  if (
    config.execution.roundTurnCostBps < 0 ||
    config.execution.roundTurnCostBps > 100
  ) {
    throw new Error("Round-turn cost reserve must be between 0 and 100 bps");
  }
  return config;
}

function mergeConfig(
  existing: StrategyConfig,
  updates: Partial<StrategyConfig>
): StrategyConfig {
  if (updates.kind && updates.kind !== "consensus_wif_dot_v1") {
    throw new Error("Only consensus_wif_dot_v1 is supported");
  }
  const defaults = DEFAULT_CONSENSUS_STRATEGY_CONFIG;
  return validateConfig({
    ...defaults,
    name: updates.name ?? existing.name ?? defaults.name,
    description:
      updates.description ?? existing.description ?? defaults.description,
    execution: {
      ...defaults.execution,
      roundTurnCostBps:
        updates.execution?.roundTurnCostBps ??
        existing.execution.roundTurnCostBps,
      maxGrossLeverage:
        updates.execution?.maxGrossLeverage ??
        existing.execution.maxGrossLeverage,
    },
    wif: {
      ...defaults.wif,
      enabled: updates.wif?.enabled ?? existing.wif.enabled,
    },
    dot: {
      ...defaults.dot,
      enabled: updates.dot?.enabled ?? existing.dot.enabled,
    },
    risk: {
      ...existing.risk,
      ...updates.risk,
    },
    runtime: existing.runtime,
    validation: existing.validation,
  });
}

function runtime(
  equity: number
): Omit<StrategyRuntimeState, "updatedAt"> {
  return {
    mode: "base",
    initialEquity: equity,
    equity,
    highWaterEquity: equity,
    lastDeriskHighWaterEquity: equity,
  };
}

function runtimeToConfig(
  config: StrategyConfig,
  state: Omit<StrategyRuntimeState, "updatedAt"> | StrategyRuntimeState
): StrategyConfig {
  return {
    ...config,
    runtime: {
      ...state,
      updatedAt: new Date().toISOString(),
    },
  };
}

async function ownedCanonical(strategyId: string, userId: string) {
  const [found] = await db
    .select()
    .from(strategy)
    .where(
      and(
        eq(strategy.id, strategyId),
        eq(strategy.userId, userId),
        consensusKind
      )
    );
  return found ?? null;
}

export const strategyService = {
  getDefaultConfig(): StrategyConfig {
    return cloneConfig(DEFAULT_CONSENSUS_STRATEGY_CONFIG);
  },

  async create(userId: string, config: StrategyConfig): Promise<StrategyRecord> {
    const normalized = mergeConfig(this.getDefaultConfig(), config);
    const [created] = await db
      .insert(strategy)
      .values({
        userId,
        name: normalized.name,
        description: normalized.description,
        config: normalized,
        leanCode: generateConsensusLeanCode(normalized),
      })
      .returning();
    return created!;
  },

  async ensureCanonical(userId: string): Promise<StrategyRecord> {
    const [existing] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.userId, userId), consensusKind))
      .orderBy(desc(strategy.updatedAt))
      .limit(1);
    if (existing) return existing;
    return this.create(userId, this.getDefaultConfig());
  },

  async update(
    strategyId: string,
    userId: string,
    updates: Partial<StrategyConfig>
  ): Promise<StrategyRecord> {
    const existing = await ownedCanonical(strategyId, userId);
    if (!existing) throw new Error("Canonical strategy not found");
    const newConfig = mergeConfig(existing.config, updates);
    const [updated] = await db
      .update(strategy)
      .set({
        name: newConfig.name,
        description: newConfig.description,
        config: newConfig,
        leanCode: generateConsensusLeanCode(newConfig),
      })
      .where(eq(strategy.id, strategyId))
      .returning();
    return updated!;
  },

  async persistRuntime(
    strategyId: string,
    userId: string,
    state: Omit<StrategyRuntimeState, "updatedAt"> | StrategyRuntimeState
  ): Promise<StrategyRecord> {
    const existing = await ownedCanonical(strategyId, userId);
    if (!existing) throw new Error("Canonical strategy not found");
    const [updated] = await db
      .update(strategy)
      .set({ config: runtimeToConfig(existing.config, state) })
      .where(eq(strategy.id, strategyId))
      .returning();
    return updated!;
  },

  async resetRuntime(
    strategyId: string,
    userId: string,
    equity: number
  ): Promise<StrategyRecord> {
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new Error("A positive account equity is required");
    }
    return this.persistRuntime(strategyId, userId, runtime(equity));
  },

  async startForwardValidation(
    strategyId: string,
    userId: string,
    equity: number
  ): Promise<StrategyRecord> {
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new Error("A positive account equity is required");
    }
    const existing = await ownedCanonical(strategyId, userId);
    if (!existing) throw new Error("Canonical strategy not found");
    const startedAt = new Date().toISOString();
    const [updated] = await db
      .update(strategy)
      .set({
        config: {
          ...runtimeToConfig(existing.config, runtime(equity)),
          validation: { startedAt },
        },
      })
      .where(eq(strategy.id, strategyId))
      .returning();
    return updated!;
  },

  async getById(strategyId: string): Promise<StrategyRecord | null> {
    const [found] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.id, strategyId), consensusKind));
    return found ?? null;
  },

  async getByUser(userId: string): Promise<StrategyRecord[]> {
    return db
      .select()
      .from(strategy)
      .where(and(eq(strategy.userId, userId), consensusKind))
      .orderBy(desc(strategy.updatedAt));
  },

  async getActiveByUser(userId: string): Promise<StrategyRecord | null> {
    const [found] = await db
      .select()
      .from(strategy)
      .where(
        and(
          eq(strategy.userId, userId),
          eq(strategy.isActive, true),
          consensusKind
        )
      )
      .orderBy(desc(strategy.updatedAt))
      .limit(1);
    return found ?? null;
  },

  async getActive(): Promise<StrategyRecord[]> {
    return db
      .select()
      .from(strategy)
      .where(and(eq(strategy.isActive, true), consensusKind))
      .orderBy(desc(strategy.updatedAt));
  },

  async toggleActive(strategyId: string, userId: string): Promise<boolean> {
    const existing = await ownedCanonical(strategyId, userId);
    if (!existing) throw new Error("Canonical strategy not found");
    const newActive = !existing.isActive;
    if (newActive) {
      await db
        .update(strategy)
        .set({ isActive: false })
        .where(eq(strategy.userId, userId));
    }
    await db
      .update(strategy)
      .set({ isActive: newActive })
      .where(eq(strategy.id, strategyId));
    return newActive;
  },

  generateLeanCode(config: StrategyConfig): string {
    return generateConsensusLeanCode(config);
  },
};
