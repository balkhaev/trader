import {
  db,
  DEFAULT_CONSENSUS_STRATEGY_CONFIG,
  strategy,
  type StrategyConfig,
  type StrategyRuntimeState,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { generateConsensusLeanCode } from "./lean-code";

export type StrategyRecord = InferSelectModel<typeof strategy>;

function cloneConfig(config: StrategyConfig): StrategyConfig {
  return structuredClone(config);
}

function mergeConfig(
  existing: StrategyConfig,
  updates: Partial<StrategyConfig>
): StrategyConfig {
  if (updates.kind && updates.kind !== "consensus_wif_dot_v1") {
    throw new Error("Only consensus_wif_dot_v1 is supported");
  }

  return {
    ...existing,
    ...updates,
    kind: "consensus_wif_dot_v1",
    execution: { ...existing.execution, ...updates.execution },
    wif: { ...existing.wif, ...updates.wif },
    dot: {
      ...existing.dot,
      ...updates.dot,
      weekdayFundingThresholdBps: {
        ...existing.dot.weekdayFundingThresholdBps,
        ...updates.dot?.weekdayFundingThresholdBps,
      },
    },
    risk: { ...existing.risk, ...updates.risk },
    runtime: updates.runtime ?? existing.runtime,
  };
}

function runtimeToConfig(
  config: StrategyConfig,
  runtime: Omit<StrategyRuntimeState, "updatedAt"> | StrategyRuntimeState
): StrategyConfig {
  return {
    ...config,
    runtime: {
      ...runtime,
      updatedAt: new Date().toISOString(),
    },
  };
}

export const strategyService = {
  getDefaultConfig(): StrategyConfig {
    return cloneConfig(DEFAULT_CONSENSUS_STRATEGY_CONFIG);
  },

  async create(
    userId: string,
    config: StrategyConfig
  ): Promise<StrategyRecord> {
    const normalized = mergeConfig(this.getDefaultConfig(), config);
    const leanCode = generateConsensusLeanCode(normalized);

    const [created] = await db
      .insert(strategy)
      .values({
        userId,
        name: normalized.name,
        description: normalized.description,
        config: normalized,
        leanCode,
      })
      .returning();

    return created!;
  },

  async ensureCanonical(userId: string): Promise<StrategyRecord> {
    const strategies = await this.getByUser(userId);
    const existing = strategies.find(
      (item) => item.config.kind === "consensus_wif_dot_v1"
    );
    if (existing) return existing;
    return this.create(userId, this.getDefaultConfig());
  },

  async update(
    strategyId: string,
    userId: string,
    updates: Partial<StrategyConfig>
  ): Promise<StrategyRecord> {
    const [existing] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.id, strategyId), eq(strategy.userId, userId)));

    if (!existing) throw new Error("Strategy not found");

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
    runtime: Omit<StrategyRuntimeState, "updatedAt"> | StrategyRuntimeState
  ): Promise<StrategyRecord> {
    const [existing] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.id, strategyId), eq(strategy.userId, userId)));

    if (!existing) throw new Error("Strategy not found");

    const config = runtimeToConfig(existing.config, runtime);
    const [updated] = await db
      .update(strategy)
      .set({ config })
      .where(eq(strategy.id, strategyId))
      .returning();

    return updated!;
  },

  async delete(strategyId: string, userId: string): Promise<void> {
    await db
      .delete(strategy)
      .where(and(eq(strategy.id, strategyId), eq(strategy.userId, userId)));
  },

  async getById(strategyId: string): Promise<StrategyRecord | null> {
    const [found] = await db
      .select()
      .from(strategy)
      .where(eq(strategy.id, strategyId));
    return found ?? null;
  },

  async getByUser(userId: string): Promise<StrategyRecord[]> {
    return db
      .select()
      .from(strategy)
      .where(eq(strategy.userId, userId))
      .orderBy(desc(strategy.updatedAt));
  },

  async getActiveByUser(userId: string): Promise<StrategyRecord | null> {
    const [found] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.userId, userId), eq(strategy.isActive, true)))
      .orderBy(desc(strategy.updatedAt))
      .limit(1);
    return found ?? null;
  },

  async getActive(): Promise<StrategyRecord[]> {
    return db
      .select()
      .from(strategy)
      .where(eq(strategy.isActive, true))
      .orderBy(desc(strategy.updatedAt));
  },

  async getPublic(limit = 20): Promise<StrategyRecord[]> {
    return db
      .select()
      .from(strategy)
      .where(eq(strategy.isPublic, true))
      .orderBy(desc(strategy.createdAt))
      .limit(limit);
  },

  async toggleActive(strategyId: string, userId: string): Promise<boolean> {
    const [existing] = await db
      .select()
      .from(strategy)
      .where(and(eq(strategy.id, strategyId), eq(strategy.userId, userId)));
    if (!existing) throw new Error("Strategy not found");

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
