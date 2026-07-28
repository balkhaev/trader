import { db, signal } from "@trader/db";
import { and, desc, eq } from "drizzle-orm";
import { autoTradingService } from "../auto-trading/auto-trading.service";
import { consensusMarketService } from "./consensus-market.service";
import {
  consensusWifDotService,
  type StrategyRiskState,
} from "./consensus-wif-dot.service";
import { strategyService } from "./strategy.service";

interface ScanOptions {
  execute?: boolean;
  now?: number;
}

const activeScans = new Set<string>();

function stateFromRuntime(
  runtime:
    | {
        mode: "base" | "boost" | "stopped";
        initialEquity: number;
        equity: number;
        highWaterEquity: number;
        lastDeriskHighWaterEquity: number;
      }
    | undefined,
  equity: number
): StrategyRiskState {
  return runtime
    ? { ...runtime }
    : consensusWifDotService.createInitialRiskState(equity);
}

async function findByDedupeKey(userId: string, dedupeKey: string) {
  const recent = await db
    .select()
    .from(signal)
    .where(eq(signal.userId, userId))
    .orderBy(desc(signal.createdAt))
    .limit(500);
  return (
    recent.find(
      (row) =>
        (row.metadata as { dedupeKey?: string } | null)?.dedupeKey === dedupeKey
    ) ?? null
  );
}

async function scanUserUnlocked(userId: string, options: ScanOptions) {
  const strategyRecord = await strategyService.getActiveByUser(userId);
  if (!strategyRecord) {
    return { scanned: false, reason: "No active canonical strategy", signals: [] };
  }

  let context = await autoTradingService
    .getExecutionContext(userId)
    .catch(() => null);
  if (context) {
    await autoTradingService
      .closeExpiredStrategySignals(userId, context)
      .catch(() => undefined);
    context = await autoTradingService
      .getExecutionContext(userId)
      .catch(() => null);
  }

  const market = await consensusMarketService.scan(options.now);
  const runtime = strategyRecord.config.runtime;
  const fallbackEquity = runtime?.equity ?? runtime?.initialEquity ?? 10_000;
  const equity = context?.equity ?? fallbackEquity;
  const openGrossNotional = context?.openGrossNotional ?? 0;
  const evaluation = consensusWifDotService.evaluate({
    config: strategyRecord.config,
    state: stateFromRuntime(runtime, equity),
    equity,
    openGrossNotional,
    wif: market.wif,
    dot: market.dot,
  });
  await strategyService.persistRuntime(
    strategyRecord.id,
    userId,
    evaluation.state
  );

  const results: Array<{
    id: string;
    module: string;
    symbol: string;
    executed: boolean;
    executionReason?: string;
  }> = [];

  for (const candidate of evaluation.signals) {
    const dedupeKey = `${candidate.signal.module}:${candidate.signal.signalTime}`;
    const existing = await findByDedupeKey(userId, dedupeKey);
    if (existing) {
      let executed = false;
      let executionReason = "Signal already recorded";
      if ((options.execute ?? false) && existing.status === "pending") {
        const execution = await autoTradingService.executeAutoTrade(
          userId,
          existing
        );
        executed = execution.executed;
        executionReason = execution.reason;
      }
      results.push({
        id: existing.id,
        module: candidate.signal.module,
        symbol: candidate.signal.symbol,
        executed,
        executionReason,
      });
      continue;
    }

    const [createdSignal] = await db
      .insert(signal)
      .values({
        userId,
        source: "webhook",
        symbol: candidate.signal.symbol,
        side: candidate.signal.side,
        strength: String(candidate.signal.strength),
        status: "pending",
        metadata: {
          strategyKind: strategyRecord.config.kind,
          strategyId: strategyRecord.id,
          dedupeKey,
          reasoning: candidate.signal.reason,
          strategySignal: candidate.signal,
          positionPreview: candidate.position,
          marketDiagnostics: market.diagnostics,
          scannedAt: market.scannedAt,
        },
      })
      .returning();

    if (!createdSignal) continue;
    let executed = false;
    let executionReason: string | undefined;
    if (options.execute ?? false) {
      const execution = await autoTradingService.executeAutoTrade(
        userId,
        createdSignal
      );
      executed = execution.executed;
      executionReason = execution.reason;
    }
    results.push({
      id: createdSignal.id,
      module: candidate.signal.module,
      symbol: candidate.signal.symbol,
      executed,
      executionReason,
    });
  }

  return {
    scanned: true,
    strategyId: strategyRecord.id,
    riskState: evaluation.state,
    market,
    signals: results,
    nextScanAt: consensusMarketService.getExpectedNextScan(options.now),
  };
}

export const strategyRunnerService = {
  async scanUser(userId: string, options: ScanOptions = {}) {
    if (activeScans.has(userId)) {
      return {
        scanned: false,
        reason: "A strategy scan is already in progress",
        signals: [],
      };
    }
    activeScans.add(userId);
    try {
      return await scanUserUnlocked(userId, options);
    } finally {
      activeScans.delete(userId);
    }
  },
};
