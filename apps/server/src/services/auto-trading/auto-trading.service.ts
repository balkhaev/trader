import {
  autoTradingConfig,
  autoTradingLog,
  db,
  exchangeAccount,
  signal,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { decrypt } from "../crypto.service";
import { createExchangeService, type ExchangeService } from "../exchange";
import type { Order } from "../exchange/types";
import { telegramService } from "../notifications";
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

const STRATEGY_SYMBOLS = new Set(["WIFUSDT", "DOTUSDT"]);
const DEFAULT_COST_BPS = 20;

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

export interface AutoTradingPreflight {
  ready: boolean;
  checks: {
    config: boolean;
    account: boolean;
    venue: boolean;
    liveAllowed: boolean;
    canTrade: boolean;
    oneWayMode: boolean;
    positionsSafe: boolean;
    strategyActive: boolean;
    riskState: boolean;
  };
  reasons: string[];
  account?: { id: string; name: string; testnet: boolean };
  equity?: number;
  positions?: number;
}

interface ConsensusSignalMetadata {
  strategyKind: "consensus_wif_dot_v1";
  strategyId: string;
  dedupeKey: string;
  strategySignal: StrategySignalPlan;
  positionPreview?: PositionPlan;
  positionPlan?: PositionPlan & { quantity?: number };
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

function fixedConfigDefaults(userId: string) {
  return {
    userId,
    minSignalStrength: "0",
    allowedSources: ["webhook"],
    allowedSymbols: ["WIFUSDT", "DOTUSDT"],
    blockedSymbols: null,
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
    defaultStopLossPercent: "0",
    defaultTakeProfitPercent: "0",
  } as const;
}

function firstPositivePrice(...values: Array<string | undefined>): string | null {
  const found = values.find((value) => Number(value) > 0);
  return found ?? null;
}

async function cancelSymbolOrders(
  service: ExchangeService,
  symbol: string
): Promise<void> {
  if (service.cancelAllOrders) {
    await service.cancelAllOrders(symbol).catch(() => undefined);
    return;
  }
  const orders = await service.getOpenOrders(symbol).catch(() => []);
  await Promise.all(
    orders.map((order) =>
      service.cancelOrder(order.id, symbol).catch(() => undefined)
    )
  );
}

async function resolveExitPrice(
  service: ExchangeService,
  item: Signal,
  closingOrder?: Order
): Promise<string> {
  const fromOrder = firstPositivePrice(
    closingOrder?.avgPrice,
    closingOrder?.price
  );
  if (fromOrder) return fromOrder;
  const executedAt = item.executedAt ?? item.createdAt;
  const trades = (await service.getTradeHistory(item.symbol, 100).catch(() => []))
    .filter(
      (trade) =>
        trade.side === "sell" && trade.executedAt.getTime() >= executedAt.getTime()
    )
    .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  const quantity = trades.reduce(
    (sum, trade) => sum + Number(trade.quantity),
    0
  );
  if (quantity > 0) {
    const notional = trades.reduce(
      (sum, trade) => sum + Number(trade.quantity) * Number(trade.price),
      0
    );
    if (Number.isFinite(notional) && notional > 0) {
      return String(notional / quantity);
    }
  }
  return service.getPrice(item.symbol);
}

async function resolveNetPnlPercent(
  service: ExchangeService,
  item: Signal,
  exitPrice: string,
  notional: number
): Promise<{ value: number; source: "income" | "price" }> {
  const executedAt = item.executedAt ?? item.createdAt;
  if (service.getIncomeHistory && notional > 0) {
    const income = await service
      .getIncomeHistory(item.symbol, executedAt.getTime() - 60_000)
      .catch(() => []);
    const relevant = income.filter((row) =>
      ["REALIZED_PNL", "COMMISSION", "FUNDING_FEE"].includes(row.incomeType)
    );
    if (relevant.length > 0) {
      const pnl = relevant.reduce((sum, row) => sum + Number(row.income), 0);
      if (Number.isFinite(pnl)) {
        return { value: (pnl / notional) * 100, source: "income" };
      }
    }
  }
  const entry = Number(item.entryPrice);
  const exit = Number(exitPrice);
  const gross = entry > 0 && exit > 0 ? ((exit - entry) / entry) * 100 : 0;
  return {
    value: gross - DEFAULT_COST_BPS / 100,
    source: "price",
  };
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
        .set({ ...updates, orderType: "market" })
        .where(eq(autoTradingConfig.userId, userId))
        .returning();
      return updated!;
    }
    const [created] = await db
      .insert(autoTradingConfig)
      .values({
        ...fixedConfigDefaults(userId),
        ...updates,
        userId,
        orderType: "market",
      })
      .returning();
    return created!;
  },

  async getPreflight(userId: string): Promise<AutoTradingPreflight> {
    const config = await this.getConfig(userId);
    const reasons: string[] = [];
    const checks: AutoTradingPreflight["checks"] = {
      config: Boolean(config),
      account: false,
      venue: false,
      liveAllowed: false,
      canTrade: false,
      oneWayMode: false,
      positionsSafe: false,
      strategyActive: false,
      riskState: false,
    };
    if (!config?.exchangeAccountId) {
      reasons.push("Select a Binance USD-M account");
      return { ready: false, checks, reasons };
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
    checks.account = Boolean(account?.enabled);
    checks.venue = account?.exchange === "binance";
    checks.liveAllowed = Boolean(
      account?.testnet || process.env.ALLOW_LIVE_TRADING === "true"
    );
    if (!account?.enabled) reasons.push("Exchange account is unavailable");
    if (account?.exchange !== "binance") reasons.push("Binance USD-M is required");
    if (account && !checks.liveAllowed) {
      reasons.push("Live execution is locked; use testnet or ALLOW_LIVE_TRADING=true");
    }
    if (!account || !checks.account || !checks.venue || !checks.liveAllowed) {
      return {
        ready: false,
        checks,
        reasons,
        account: account
          ? { id: account.id, name: account.name, testnet: account.testnet }
          : undefined,
      };
    }

    try {
      const service = createExchangeService("binance", {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });
      const [accountInfo, exchangePreflight, positions, activeStrategy] =
        await Promise.all([
          service.getAccountInfo(),
          service.getPreflight?.(),
          service.getPositions(),
          strategyService.getActiveByUser(userId),
        ]);
      checks.canTrade =
        accountInfo.canTrade !== false && exchangePreflight?.canTrade !== false;
      checks.oneWayMode = exchangePreflight?.oneWayMode === true;
      checks.positionsSafe =
        positions.length <= 2 &&
        positions.every(
          (position) =>
            STRATEGY_SYMBOLS.has(position.symbol) && position.side === "long"
        );
      checks.strategyActive = Boolean(activeStrategy);
      checks.riskState = activeStrategy?.config.runtime?.mode !== "stopped";
      reasons.push(...(exchangePreflight?.messages ?? []));
      if (!checks.positionsSafe) {
        reasons.push("Only long WIFUSDT/DOTUSDT positions may be open");
      }
      if (!checks.strategyActive) reasons.push("Canonical strategy is not active");
      if (!checks.riskState) reasons.push("Strategy hard-stop is active");
      return {
        ready: Object.values(checks).every(Boolean),
        checks,
        reasons,
        account: { id: account.id, name: account.name, testnet: account.testnet },
        equity: Number(accountInfo.totalBalance),
        positions: positions.length,
      };
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
      return {
        ready: false,
        checks,
        reasons,
        account: { id: account.id, name: account.name, testnet: account.testnet },
      };
    }
  },

  async getExecutionContext(
    userId: string
  ): Promise<AutoTradingExecutionContext> {
    const config = await this.getConfig(userId);
    if (!config?.exchangeAccountId) {
      throw new Error("No Binance account configured");
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
    if (account.exchange !== "binance") {
      throw new Error("Consensus strategy requires Binance USD-M");
    }
    if (!account.testnet && process.env.ALLOW_LIVE_TRADING !== "true") {
      throw new Error("Live execution is locked; connect Binance testnet first");
    }
    const exchangeService = createExchangeService("binance", {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });
    const [accountInfo, openPositions, preflight] = await Promise.all([
      exchangeService.getAccountInfo(),
      exchangeService.getPositions(),
      exchangeService.getPreflight?.(),
    ]);
    if (accountInfo.canTrade === false || preflight?.canTrade === false) {
      throw new Error("Binance account cannot trade futures");
    }
    if (preflight?.oneWayMode !== true) {
      throw new Error("Binance One-way Mode is required");
    }
    const equity = Number(accountInfo.totalBalance);
    if (!Number.isFinite(equity) || equity <= 0) {
      throw new Error("Exchange account equity is unavailable");
    }
    const openGrossNotional = openPositions.reduce(
      (sum, position) =>
        sum + Math.abs(Number(position.quantity) * Number(position.currentPrice)),
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
    if (!config.enabled) return { should: false, reason: "Execution disabled" };
    if (!config.exchangeAccountId) {
      return { should: false, reason: "No Binance account configured" };
    }
    const metadata = metadataOf(sig);
    if (!metadata) {
      return { should: false, reason: "Not a Consensus WIF + DOT signal" };
    }
    if (sig.side !== "long" || !config.allowLong) {
      return { should: false, reason: "Only long strategy positions are allowed" };
    }
    const allowedSources = config.allowedSources as string[] | null;
    if (allowedSources?.length && !allowedSources.includes(sig.source)) {
      return { should: false, reason: `Source ${sig.source} is not allowed` };
    }
    const allowedSymbols = config.allowedSymbols as string[] | null;
    if (allowedSymbols?.length && !allowedSymbols.includes(sig.symbol)) {
      return { should: false, reason: `${sig.symbol} is outside the strategy universe` };
    }
    const maxDailyTrades = Math.max(1, Number(config.maxDailyTrades ?? "10"));
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
    return { should: true, reason: "Consensus execution checks passed" };
  },

  async executeAutoTrade(userId: string, sig: Signal): Promise<AutoTradeResult> {
    const metadata = metadataOf(sig);
    if (!metadata) {
      return { executed: false, reason: "Missing strategy metadata" };
    }
    const config = await this.getConfig(userId);
    if (!config) return { executed: false, reason: "No execution config" };
    const eligibility = await this.shouldAutoExecute(config, sig);
    if (!eligibility.should) {
      await this.logTrade(userId, sig.id, "skipped", eligibility.reason, {
        symbol: sig.symbol,
        module: metadata.strategySignal.module,
      });
      return { executed: false, reason: eligibility.reason };
    }

    try {
      const [strategyRecord, context] = await Promise.all([
        strategyService.getById(metadata.strategyId),
        this.getExecutionContext(userId),
      ]);
      if (
        !strategyRecord ||
        strategyRecord.userId !== userId ||
        !strategyRecord.isActive
      ) {
        throw new Error("Active canonical strategy not found");
      }
      if (
        context.openPositions.some((position) => position.symbol === sig.symbol)
      ) {
        throw new Error(`${sig.symbol} already has an open position`);
      }
      const maxPositions = Math.min(
        strategyRecord.config.execution.maxPositions,
        Math.max(1, Number(config.maxOpenPositions ?? "2"))
      );
      if (context.openPositions.length >= maxPositions) {
        throw new Error("Maximum open positions reached");
      }

      const state = consensusWifDotService.transitionRiskState(
        runtimeState(strategyRecord.config.runtime, context.equity),
        context.equity,
        strategyRecord.config
      );
      await strategyService.persistRuntime(strategyRecord.id, userId, state);
      if (state.mode === "stopped") {
        throw new Error("Strategy hard-stop is active");
      }
      await context.exchangeService.prepareSymbol?.(
        sig.symbol,
        strategyRecord.config.execution.maxGrossLeverage
      );

      const currentPrice = Number(
        await context.exchangeService.getPrice(sig.symbol)
      );
      const position = consensusWifDotService.calculatePositionPlan(
        { ...metadata.strategySignal, entryPrice: currentPrice },
        state,
        context.equity,
        context.openGrossNotional,
        strategyRecord.config
      );
      const configuredCap = Math.max(0, Number(config.maxPositionSize ?? "0"));
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
        type: "market",
        quantity: String(quantity),
        stopLoss: String(position.stopPrice),
        takeProfit: String(position.takeProfitPrice),
      });
      const actualEntry =
        firstPositivePrice(order.avgPrice, order.price) ?? String(currentPrice);

      await db
        .update(signal)
        .set({
          status: "executed",
          executedAt: new Date(),
          entryPrice: actualEntry,
          metadata: {
            ...(sig.metadata as Record<string, unknown>),
            autoTraded: true,
            riskMode: state.mode,
            positionPlan: { ...position, cappedNotional: notional, quantity },
            executionOrder: order,
            maxHoldMinutes: metadata.strategySignal.maxHoldMinutes,
          },
        })
        .where(and(eq(signal.id, sig.id), eq(signal.userId, userId)));

      await this.logTrade(
        userId,
        sig.id,
        "executed",
        "Consensus order executed",
        {
          orderId: order.id,
          module: metadata.strategySignal.module,
          symbol: sig.symbol,
          quantity,
          notional,
          riskMode: state.mode,
          riskPercent: position.riskPercent,
          stopPrice: position.stopPrice,
          takeProfitPrice: position.takeProfitPrice,
        }
      );
      await telegramService
        .notifyTradeOpened(userId, {
          symbol: sig.symbol,
          side: "long",
          entryPrice: actualEntry,
        })
        .catch(() => undefined);
      return {
        executed: true,
        reason: "Consensus order executed",
        orderId: order.id,
        details: { position, quantity, notional, riskMode: state.mode },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.logTrade(userId, sig.id, "error", reason, {
        module: metadata.strategySignal.module,
        symbol: sig.symbol,
      });
      return { executed: false, reason };
    }
  },

  async closeExpiredStrategySignals(
    userId: string,
    suppliedContext?: AutoTradingExecutionContext
  ): Promise<number> {
    const openSignals = await db
      .select()
      .from(signal)
      .where(
        and(
          eq(signal.userId, userId),
          eq(signal.status, "executed"),
          isNull(signal.exitPrice)
        )
      )
      .orderBy(desc(signal.executedAt))
      .limit(200);
    const strategySignals = openSignals.filter((item) => metadataOf(item));
    if (strategySignals.length === 0) return 0;

    let context = suppliedContext ?? (await this.getExecutionContext(userId));
    let closed = 0;
    for (const item of strategySignals) {
      const metadata = metadataOf(item)!;
      try {
        const executedAt = item.executedAt ?? item.createdAt;
        const expiresAt =
          executedAt.getTime() + metadata.strategySignal.maxHoldMinutes * 60_000;
        const position = context.openPositions.find(
          (candidate) => candidate.symbol === item.symbol
        );
        if (Date.now() < expiresAt && position) continue;

        let closingOrder: Order | undefined;
        let closeReason = "exchange_exit";
        if (position) {
          closeReason = "time_exit";
          closingOrder = await context.exchangeService.createOrder({
            symbol: item.symbol,
            side: position.side === "long" ? "sell" : "buy",
            type: "market",
            quantity: position.quantity,
            reduceOnly: true,
          });
        }
        await cancelSymbolOrders(context.exchangeService, item.symbol);
        const exitPrice = await resolveExitPrice(
          context.exchangeService,
          item,
          closingOrder
        );
        const notional = Number(
          metadata.positionPlan?.cappedNotional ??
            metadata.positionPreview?.cappedNotional ??
            0
        );
        const netPnl = await resolveNetPnlPercent(
          context.exchangeService,
          item,
          exitPrice,
          notional
        );
        const exitAt = new Date();
        const holdingMinutes = Math.max(
          0,
          Math.floor((exitAt.getTime() - executedAt.getTime()) / 60_000)
        );
        await db
          .update(signal)
          .set({
            exitPrice,
            exitAt,
            realizedPnl: String(netPnl.value.toFixed(4)),
            holdingPeriodMinutes: String(holdingMinutes),
            isWin: netPnl.value > 0,
            metadata: {
              ...(item.metadata as Record<string, unknown>),
              closedByStrategy: true,
              closeReason,
              pnlSource: netPnl.source,
              closedAt: exitAt.toISOString(),
            },
          })
          .where(and(eq(signal.id, item.id), eq(signal.userId, userId)));
        await this.logTrade(userId, item.id, "closed", closeReason, {
          module: metadata.strategySignal.module,
          symbol: item.symbol,
          exitPrice,
          netPnlPercent: netPnl.value,
          pnlSource: netPnl.source,
        });
        closed += 1;
        context = await this.getExecutionContext(userId);
      } catch (error) {
        await this.logTrade(
          userId,
          item.id,
          "error",
          error instanceof Error ? error.message : String(error),
          { symbol: item.symbol, module: metadata.strategySignal.module }
        );
      }
    }
    return closed;
  },

  async emergencyStop(userId: string): Promise<{ closed: number }> {
    await this.upsertConfig(userId, { enabled: false });
    const context = await this.getExecutionContext(userId);
    let closed = 0;
    for (const position of context.openPositions) {
      if (!STRATEGY_SYMBOLS.has(position.symbol)) continue;
      await context.exchangeService.createOrder({
        symbol: position.symbol,
        side: position.side === "long" ? "sell" : "buy",
        type: "market",
        quantity: position.quantity,
        reduceOnly: true,
      });
      await cancelSymbolOrders(context.exchangeService, position.symbol);
      closed += 1;
    }
    return { closed };
  },

  async logTrade(
    userId: string,
    signalId: string | null,
    action: "executed" | "skipped" | "error" | "closed",
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
      .limit(Math.min(100, Math.max(1, limit)));
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
      todayClosed: logs.filter((item) => item.action === "closed").length,
      todaySkipped: logs.filter((item) => item.action === "skipped").length,
      todayErrors: logs.filter((item) => item.action === "error").length,
      totalToday: logs.length,
    };
  },
};
