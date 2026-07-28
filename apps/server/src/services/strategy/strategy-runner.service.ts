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

function stateFromRecord(
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

async function hasDedupeKey(
  userId: string,
  dedupeKey: string
): Promise<boolean> {
  const recent = await db
    .select({ metadata: signal.metadata })
    .from(signal)
    .where(and(eq(signal.userId, userId), eq(signal.source, "webhook")))
    .orderBy(desc(signal.createdAt))
    .limit(200);
  return recent.some(
    (row) =>
      (row.metadata as { dedupeKey?: string } | null)?.dedupeKey === dedupeKey
  );
}

export const strategyRunnerService = {
  async scanUser(userId: string, options: ScanOptions = {}) {
    const strategyRecord = await strategyService.getActiveByUser(userId);
    if (!strategyRecord) {
      return { scanned: false, reason: "No active strategy", signals: [] };
    }

    await autoTradingService
      .closeExpiredStrategySignals(userId)
      .catch(() => undefined);
    const [market, context] = await Promise.all([
      consensusMarketService.scan(options.now),
      autoTradingService.getExecutionContext(userId),
    ]);
    const initialState = stateFromRecord(
      strategyRecord.config.runtime,
      context.equity
    );
    const evaluation = consensusWifDotService.evaluate({
      config: strategyRecord.config,
      state: initialState,
      equity: context.equity,
      openGrossNotional: context.openGrossNotional,
      wif: market.wif,
      dot: market.dot,
    });
    await strategyService.persistRuntime(
      strategyRecord.id,
      userId,
      evaluation.state
    );

    const created: Array<{
      id: string;
      module: string;
      symbol: string;
      executed: boolean;
      executionReason?: string;
    }> = [];

    for (const candidate of evaluation.signals) {
      const dedupeKey = `${candidate.signal.module}:${candidate.signal.signalTime}`;
      if (await hasDedupeKey(userId, dedupeKey)) continue;

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
      if (options.execute ?? true) {
        const result = await autoTradingService.executeAutoTrade(
          userId,
          createdSignal
        );
        executed = result.executed;
        executionReason = result.reason;
      }
      created.push({
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
      signals: created,
      nextScanAt: consensusMarketService.getExpectedNextScan(options.now),
    };
  },
};
