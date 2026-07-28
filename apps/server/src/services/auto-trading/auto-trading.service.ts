import {
  autoTradingConfig,
  autoTradingLog,
  db,
  exchangeAccount,
  signal,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { decrypt } from "../crypto.service";
import { createExchangeService, type ExchangeService } from "../exchange";
import { telegramService } from "../notifications";
import { signalService } from "../signals/signal.service";
import {
  consensusWifDotService,
  type PositionPlan,
  type StrategyRiskState,
  type StrategySignalPlan,
} from "../strategy/consensus-wif-dot.service";
import { strategyService } from "../strategy/strategy.service";

type Signal = InferSelectModel<typeof signal>;
type AutoTradingConfig = InferSelectModel<typeof autoTradingConfig>;
type ExchangeAccount = InferSelectModel<typeof exchangeAccount>;

interface AutoTradeResult {
  executed: boolean;
  reason: string;
  orderId?: string;
  details?: Record<string, unknown>;
}

export interface AutoTradingExecutionContext {
  config: AutoTradingConfig;
  account: ExchangeAccount;
  exchangeService: ExchangeService;
  equity: number;
  openGrossNotional: number;
  openPositions: Awaited<ReturnType<ExchangeService["getPositions"]>>;
}

interface ConsensusSignalMetadata {
  strategyKind: "consensus_wif_dot_v1";
  strategyId: string;
  dedupeKey: string;
  strategySignal: StrategySignalPlan;
  positionPreview?: PositionPlan;
}

function metadataOf(sig: Signal): ConsensusSignalMetadata | null {
  const metadata = sig.metadata as Partial<ConsensusSignalMetadata> | null;
  if (
    metadata?.strategyKind !== "consensus_wif_dot_v1" ||
    !metadata.strategyId ||
    !metadata.strategySignal
  ) {
    return null;
  }
  return metadata as ConsensusSignalMetadata;
}

function runtimeState(
  strategyRuntime:
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
  return strategyRuntime
    ? { ...strategyRuntime }
    : consensusWifDotService.createInitialRiskState(equity);
}

export const autoTradingService = {
  async getConfig(userId: string): Promise<AutoTradingConfig | null> {
    const [config] = await db
      .select()
      .from(autoTradingConfig)
      .where(eq(autoTradingConfig.userId, userId));
    return config ?? null;
  },

  async upsertConfig(
    userId: string,
    updates: Partial<
      Omit<AutoTradingConfig, "id" | "userId" | "createdAt" | "updatedAt">
    >
  ): Promise<AutoTradingConfig> {
    const existing = await this.getConfig(userId);
    if (existing) {
      const [updated] = await db
        .update(autoTradingConfig)
        .set(updates)
        .where(eq(autoTradingConfig.userId, userId))
        .returning();
      return updated!;
    }
    const [created] = await db
      .insert(autoTradingConfig)
      .values({
        userId,
        minSignalStrength: "0",
        allowedSources: ["webhook"],
        allowedSymbols: ["WIFUSDT", "DOTUSDT"],
        allowLong: true,
        allowShort: false,
        positionSizeType: "risk_based",
        positionSizeValue: "1",
        maxPositionSize: "0",
        maxDailyTrades: "10",
        maxOpenPositions: "2",
        maxDailyLossPercent: "15",
        orderType: "market",
        useStopLoss: true,
        useTakeProfit: true,
        ...updates,
      })
      .returning();
    return created!;
  },

  async getExecutionContext(
    userId: string
  ): Promise<AutoTradingExecutionContext> {
    const config = await this.getConfig(userId);
    if (!config?.exchangeAccountId) {
      throw new Error("No exchange account configured");
    }
    const [account] = await db
      .select()
      .from(exchangeAccount)
      .where(
        and(
          eq(exchangeAccount.id, config.exchangeAccountId),
          eq(exchangeAccount.userId, userId)
        )
      );
    if (!account?.enabled) throw new Error("Exchange account is unavailable");

    const exchangeService = createExchangeService(account.exchange, {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });
    const [accountInfo, openPositions] = await Promise.all([
      exchangeService.getAccountInfo(),
      exchangeService.getPositions(),
    ]);
    const equity = Number(accountInfo.totalBalance);
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new Error("Exchange account equity is unavailable");
    }
    const openGrossNotional = openPositions.reduce(
      (sum, position) =>
        sum +
        Math.abs(Number(position.quantity) * Number(position.currentPrice)),
      0
    );
    return {
      config,
      account,
      exchangeService,
      equity,
      openGrossNotional,
      openPositions,
    };
  },

  async shouldAutoExecute(
    config: AutoTradingConfig,
    sig: Signal
  ): Promise<{ should: boolean; reason: string }> {
    if (!config.enabled)
      return { should: false, reason: "Auto-trading disabled" };
    if (!config.exchangeAccountId) {
      return { should: false, reason: "No exchange account configured" };
    }
    const metadata = metadataOf(sig);
    if (!metadata) {
      return {
        should: false,
        reason: "Signal is not a Consensus WIF + DOT signal",
      };
    }
    if (sig.side !== "long" || !config.allowLong) {
      return {
        should: false,
        reason: "Only long strategy positions are allowed",
      };
    }
    const allowedSources = config.allowedSources as string[] | null;
    if (allowedSources?.length && !allowedSources.includes(sig.source)) {
      return { should: false, reason: `Source ${sig.source} is not allowed` };
    }
    const allowedSymbols = config.allowedSymbols as string[] | null;
    if (allowedSymbols?.length && !allowedSymbols.includes(sig.symbol)) {
      return {
        should: false,
        reason: `${sig.symbol} is outside the strategy universe`,
      };
    }

    const maxDailyTrades = Number(config.maxDailyTrades ?? "10");
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [today] = await db
      .select({ count: sql<number>`count(*)` })
      .from(autoTradingLog)
      .where(
        and(
          eq(autoTradingLog.userId, config.userId),
          eq(autoTradingLog.action, "executed"),
          gte(autoTradingLog.createdAt, todayStart)
        )
      );
    if (Number(today?.count ?? 0) >= maxDailyTrades) {
      return { should: false, reason: "Daily trade limit reached" };
    }
    return { should: true, reason: "Consensus strategy checks passed" };
  },

  async executeAutoTrade(
    userId: string,
    sig: Signal
  ): Promise<AutoTradeResult> {
    const metadata = metadataOf(sig);
    if (!metadata) {
      return { executed: false, reason: "Missing consensus strategy metadata" };
    }
    const config = await this.getConfig(userId);
    if (!config) return { executed: false, reason: "No auto-trading config" };
    const eligibility = await this.shouldAutoExecute(config, sig);
    if (!eligibility.should) {
      await this.logTrade(userId, sig.id, "skipped", eligibility.reason);
      return { executed: false, reason: eligibility.reason };
    }

    try {
      const [strategyRecord, context] = await Promise.all([
        strategyService.getById(metadata.strategyId),
        this.getExecutionContext(userId),
      ]);
      if (!strategyRecord || strategyRecord.userId !== userId) {
        throw new Error("Active strategy not found");
      }
      if (context.account.exchange !== "binance") {
        throw new Error("Consensus strategy requires a Binance USD-M account");
      }
      if (
        context.openPositions.some((position) => position.symbol === sig.symbol)
      ) {
        throw new Error(`${sig.symbol} already has an open position`);
      }
      const maxPositions = Math.min(
        strategyRecord.config.execution.maxPositions,
        Number(config.maxOpenPositions ?? "2")
      );
      if (context.openPositions.length >= maxPositions) {
        throw new Error("Maximum open positions reached");
      }

      const initialState = runtimeState(
        strategyRecord.config.runtime,
        context.equity
      );
      const state = consensusWifDotService.transitionRiskState(
        initialState,
        context.equity,
        strategyRecord.config
      );
      await strategyService.persistRuntime(strategyRecord.id, userId, state);
      if (state.mode === "stopped") {
        throw new Error("Strategy hard-stop is active");
      }

      const currentPrice = Number(
        await context.exchangeService.getPrice(sig.symbol)
      );
      const liveSignal = {
        ...metadata.strategySignal,
        entryPrice: currentPrice,
      };
      const position = consensusWifDotService.calculatePositionPlan(
        liveSignal,
        state,
        context.equity,
        context.openGrossNotional,
        strategyRecord.config
      );
      const configuredCap = Number(config.maxPositionSize ?? "0");
      const notional =
        configuredCap > 0
          ? Math.min(position.cappedNotional, configuredCap)
          : position.cappedNotional;
      const quantity = notional / currentPrice;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Risk and gross limits leave no executable quantity");
      }

      const order = await context.exchangeService.createOrder({
        symbol: sig.symbol,
        side: "buy",
        type: strategyRecord.config.execution.orderType,
        quantity: String(quantity),
        stopLoss: String(position.stopPrice),
        takeProfit: String(position.takeProfitPrice),
      });

      await db
        .update(signal)
        .set({
          status: "executed",
          executedAt: new Date(),
          entryPrice: order.avgPrice || order.price || String(currentPrice),
          metadata: {
            ...(sig.metadata as Record<string, unknown>),
            autoTraded: true,
            riskMode: state.mode,
            positionPlan: { ...position, cappedNotional: notional, quantity },
            executionOrder: order,
            maxHoldMinutes: metadata.strategySignal.maxHoldMinutes,
          },
        })
        .where(eq(signal.id, sig.id));

      await this.logTrade(
        userId,
        sig.id,
        "executed",
        "Consensus order executed",
        {
          orderId: order.id,
          symbol: sig.symbol,
          quantity,
          notional,
          riskMode: state.mode,
          riskPercent: position.riskPercent,
          stopPrice: position.stopPrice,
          takeProfitPrice: position.takeProfitPrice,
        }
      );
      await telegramService.notifyTradeOpened(userId, {
        symbol: sig.symbol,
        side: "long",
        entryPrice: order.avgPrice || order.price || String(currentPrice),
      });
      return {
        executed: true,
        reason: "Consensus order executed",
        orderId: order.id,
        details: { position, quantity, notional, riskMode: state.mode },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.logTrade(userId, sig.id, "error", reason);
      return { executed: false, reason };
    }
  },

  async closeExpiredStrategySignals(userId: string): Promise<number> {
    const executed = await signalService.getAll(userId, {
      status: "executed",
      limit: 200,
    });
    const openSignals = executed.filter(
      (item) => item.exitPrice === null && metadataOf(item)
    );
    if (openSignals.length === 0) return 0;

    const context = await this.getExecutionContext(userId);
    let closed = 0;
    for (const item of openSignals) {
      const metadata = metadataOf(item)!;
      const executedAt = item.executedAt ?? item.createdAt;
      const expiresAt =
        executedAt.getTime() + metadata.strategySignal.maxHoldMinutes * 60_000;
      const position = context.openPositions.find(
        (candidate) => candidate.symbol === item.symbol
      );
      if (Date.now() < expiresAt && position) continue;

      const price = await context.exchangeService.getPrice(item.symbol);
      if (position) {
        await context.exchangeService.createOrder({
          symbol: item.symbol,
          side: position.side === "long" ? "sell" : "buy",
          type: "market",
          quantity: position.quantity,
          reduceOnly: true,
        });
      }
      await signalService.closeSignal(item.id, userId, { exitPrice: price });
      closed += 1;
    }
    return closed;
  },

  async logTrade(
    userId: string,
    signalId: string | null,
    action: "executed" | "skipped" | "error",
    reason: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await db.insert(autoTradingLog).values({
      userId,
      signalId,
      action,
      reason,
      details,
    });
  },

  async getLogs(userId: string, limit = 50) {
    return db
      .select()
      .from(autoTradingLog)
      .where(eq(autoTradingLog.userId, userId))
      .orderBy(desc(autoTradingLog.createdAt))
      .limit(limit);
  },

  async getStats(userId: string) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const logs = await db
      .select()
      .from(autoTradingLog)
      .where(
        and(
          eq(autoTradingLog.userId, userId),
          gte(autoTradingLog.createdAt, todayStart)
        )
      );
    return {
      todayExecuted: logs.filter((item) => item.action === "executed").length,
      todaySkipped: logs.filter((item) => item.action === "skipped").length,
      todayErrors: logs.filter((item) => item.action === "error").length,
      totalToday: logs.length,
    };
  },
};
