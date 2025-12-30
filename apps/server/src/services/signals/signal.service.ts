import {
  db,
  exchangeAccount,
  newsAnalysis,
  signal,
  signalNewsLink,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { decrypt } from "../crypto.service";
import { createExchangeService } from "../exchange";
import type { Order } from "../exchange/types";

type Signal = InferSelectModel<typeof signal>;

export interface CreateSignalParams {
  userId: string;
  analysisId?: string;
  symbol: string;
  side: "long" | "short";
  strength: number;
  reasoning: string;
  metadata?: Record<string, unknown>;
}

export interface ApproveSignalParams {
  exchangeAccountId: string;
  quantity: string;
  orderType: "market" | "limit";
  price?: string;
  stopLoss?: string;
  takeProfit?: string;
}

export const signalService = {
  async create(params: CreateSignalParams): Promise<Signal> {
    const [newSignal] = await db
      .insert(signal)
      .values({
        userId: params.userId,
        source: "llm",
        symbol: params.symbol,
        side: params.side,
        strength: String(params.strength),
        status: "pending",
        metadata: {
          reasoning: params.reasoning,
          ...params.metadata,
        },
      })
      .returning();

    // Связываем с анализом если есть
    if (params.analysisId && newSignal) {
      await db.insert(signalNewsLink).values({
        signalId: newSignal.id,
        analysisId: params.analysisId,
      });
    }

    return newSignal!;
  },

  async approve(
    signalId: string,
    userId: string,
    params: ApproveSignalParams
  ): Promise<Order> {
    // Проверяем владельца сигнала
    const [sig] = await db
      .select()
      .from(signal)
      .where(and(eq(signal.id, signalId), eq(signal.userId, userId)));

    if (!sig) {
      throw new Error("Signal not found");
    }

    if (sig.status !== "pending") {
      throw new Error(`Signal is not pending, current status: ${sig.status}`);
    }

    // Получаем аккаунт биржи
    const [account] = await db
      .select()
      .from(exchangeAccount)
      .where(
        and(
          eq(exchangeAccount.id, params.exchangeAccountId),
          eq(exchangeAccount.userId, userId)
        )
      );

    if (!account) {
      throw new Error("Exchange account not found");
    }

    if (!account.enabled) {
      throw new Error("Exchange account is disabled");
    }

    // Создаем сервис биржи
    const exchangeService = createExchangeService(account.exchange, {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });

    // Исполняем ордер
    const order = await exchangeService.createOrder({
      symbol: sig.symbol,
      side: sig.side === "long" ? "buy" : "sell",
      type: params.orderType,
      quantity: params.quantity,
      price: params.price,
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit,
    });

    // Обновляем статус сигнала
    await db
      .update(signal)
      .set({
        status: "executed",
        executedAt: new Date(),
        metadata: {
          ...(sig.metadata as Record<string, unknown>),
          executionOrder: order,
          executionParams: params,
        },
      })
      .where(eq(signal.id, signalId));

    return order;
  },

  async reject(
    signalId: string,
    userId: string,
    reason?: string
  ): Promise<void> {
    const [sig] = await db
      .select()
      .from(signal)
      .where(and(eq(signal.id, signalId), eq(signal.userId, userId)));

    if (!sig) {
      throw new Error("Signal not found");
    }

    if (sig.status !== "pending") {
      throw new Error(`Signal is not pending, current status: ${sig.status}`);
    }

    await db
      .update(signal)
      .set({
        status: "rejected",
        metadata: {
          ...(sig.metadata as Record<string, unknown>),
          rejectionReason: reason,
          rejectedAt: new Date().toISOString(),
        },
      })
      .where(eq(signal.id, signalId));
  },

  async expire(signalId: string): Promise<void> {
    await db
      .update(signal)
      .set({ status: "expired" })
      .where(eq(signal.id, signalId));
  },

  async getPending(userId: string): Promise<Signal[]> {
    return db
      .select()
      .from(signal)
      .where(and(eq(signal.userId, userId), eq(signal.status, "pending")))
      .orderBy(desc(signal.createdAt));
  },

  async getAll(
    userId: string,
    params?: { status?: Signal["status"]; limit?: number; offset?: number }
  ): Promise<Signal[]> {
    const conditions = [eq(signal.userId, userId)];

    if (params?.status) {
      conditions.push(eq(signal.status, params.status));
    }

    return db
      .select()
      .from(signal)
      .where(and(...conditions))
      .orderBy(desc(signal.createdAt))
      .limit(params?.limit ?? 50)
      .offset(params?.offset ?? 0);
  },

  async getById(signalId: string): Promise<Signal | undefined> {
    const [sig] = await db.select().from(signal).where(eq(signal.id, signalId));
    return sig;
  },

  async getWithAnalyses(signalId: string) {
    const [sig] = await db.select().from(signal).where(eq(signal.id, signalId));

    if (!sig) return null;

    const links = await db
      .select({ analysis: newsAnalysis })
      .from(signalNewsLink)
      .innerJoin(newsAnalysis, eq(signalNewsLink.analysisId, newsAnalysis.id))
      .where(eq(signalNewsLink.signalId, signalId));

    return {
      ...sig,
      analyses: links.map((l) => l.analysis),
    };
  },

  async getStats(userId: string) {
    const signals = await db
      .select()
      .from(signal)
      .where(eq(signal.userId, userId));

    const pending = signals.filter((s) => s.status === "pending").length;
    const executed = signals.filter((s) => s.status === "executed").length;
    const rejected = signals.filter((s) => s.status === "rejected").length;
    const expired = signals.filter((s) => s.status === "expired").length;

    return {
      total: signals.length,
      pending,
      executed,
      rejected,
      expired,
      executionRate: signals.length > 0 ? executed / signals.length : 0,
    };
  },

  // === PERFORMANCE TRACKING ===

  async closeSignal(
    signalId: string,
    userId: string,
    params: { exitPrice: string }
  ): Promise<Signal> {
    const [sig] = await db
      .select()
      .from(signal)
      .where(and(eq(signal.id, signalId), eq(signal.userId, userId)));

    if (!sig) {
      throw new Error("Signal not found");
    }

    if (sig.status !== "executed") {
      throw new Error(`Signal is not executed, current status: ${sig.status}`);
    }

    if (!sig.entryPrice) {
      throw new Error("Signal has no entry price recorded");
    }

    const entryPrice = Number.parseFloat(sig.entryPrice);
    const exitPrice = Number.parseFloat(params.exitPrice);
    const executedAt = sig.executedAt ?? sig.createdAt;
    const exitAt = new Date();

    // Calculate P&L based on side
    let pnlPercent: number;
    if (sig.side === "long") {
      pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    } else {
      pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
    }

    // Calculate holding period in minutes
    const holdingPeriodMs = exitAt.getTime() - executedAt.getTime();
    const holdingPeriodMinutes = Math.floor(holdingPeriodMs / 1000 / 60);

    const isWin = pnlPercent > 0;

    const [updatedSignal] = await db
      .update(signal)
      .set({
        exitPrice: params.exitPrice,
        exitAt,
        realizedPnl: String(pnlPercent.toFixed(4)),
        holdingPeriodMinutes: String(holdingPeriodMinutes),
        isWin,
        metadata: {
          ...(sig.metadata as Record<string, unknown>),
          closedManually: true,
          closedAt: exitAt.toISOString(),
        },
      })
      .where(eq(signal.id, signalId))
      .returning();

    return updatedSignal!;
  },

  async updateEntryPrice(
    signalId: string,
    userId: string,
    entryPrice: string
  ): Promise<Signal> {
    const [sig] = await db
      .select()
      .from(signal)
      .where(and(eq(signal.id, signalId), eq(signal.userId, userId)));

    if (!sig) {
      throw new Error("Signal not found");
    }

    const [updatedSignal] = await db
      .update(signal)
      .set({ entryPrice })
      .where(eq(signal.id, signalId))
      .returning();

    return updatedSignal!;
  },

  async getPerformanceStats(userId: string) {
    const executedSignals = await db
      .select()
      .from(signal)
      .where(and(eq(signal.userId, userId), eq(signal.status, "executed")));

    const closedSignals = executedSignals.filter(
      (s) => s.exitPrice !== null && s.realizedPnl !== null
    );

    if (closedSignals.length === 0) {
      return {
        totalClosed: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        avgReturn: 0,
        totalReturn: 0,
        bestTrade: null,
        worstTrade: null,
        avgHoldingPeriodMinutes: 0,
        sharpeRatio: null,
      };
    }

    const wins = closedSignals.filter((s) => s.isWin === true);
    const losses = closedSignals.filter((s) => s.isWin === false);

    const returns = closedSignals.map((s) =>
      Number.parseFloat(s.realizedPnl ?? "0")
    );
    const totalReturn = returns.reduce((sum, r) => sum + r, 0);
    const avgReturn = totalReturn / returns.length;

    // Sort by P&L to find best/worst
    const sortedByPnl = [...closedSignals].sort((a, b) => {
      const pnlA = Number.parseFloat(a.realizedPnl ?? "0");
      const pnlB = Number.parseFloat(b.realizedPnl ?? "0");
      return pnlB - pnlA;
    });

    const bestTrade = sortedByPnl[0];
    const worstTrade = sortedByPnl[sortedByPnl.length - 1];

    // Calculate average holding period
    const holdingPeriods = closedSignals
      .map((s) => Number.parseFloat(s.holdingPeriodMinutes ?? "0"))
      .filter((h) => h > 0);
    const avgHoldingPeriodMinutes =
      holdingPeriods.length > 0
        ? holdingPeriods.reduce((sum, h) => sum + h, 0) / holdingPeriods.length
        : 0;

    // Calculate Sharpe Ratio (simplified, annualized assuming daily returns)
    let sharpeRatio: number | null = null;
    if (returns.length >= 2) {
      const mean = avgReturn;
      const variance =
        returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        // Annualize assuming ~252 trading days
        sharpeRatio = (mean / stdDev) * Math.sqrt(252);
      }
    }

    return {
      totalClosed: closedSignals.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate:
        closedSignals.length > 0 ? wins.length / closedSignals.length : 0,
      avgReturn,
      totalReturn,
      bestTrade: bestTrade
        ? {
            id: bestTrade.id,
            symbol: bestTrade.symbol,
            side: bestTrade.side,
            pnl: Number.parseFloat(bestTrade.realizedPnl ?? "0"),
          }
        : null,
      worstTrade: worstTrade
        ? {
            id: worstTrade.id,
            symbol: worstTrade.symbol,
            side: worstTrade.side,
            pnl: Number.parseFloat(worstTrade.realizedPnl ?? "0"),
          }
        : null,
      avgHoldingPeriodMinutes,
      sharpeRatio,
    };
  },

  async getClosedSignals(
    userId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<Signal[]> {
    const results = await db
      .select()
      .from(signal)
      .where(and(eq(signal.userId, userId), eq(signal.status, "executed")))
      .orderBy(desc(signal.exitAt))
      .limit(params?.limit ?? 50)
      .offset(params?.offset ?? 0);

    // Filter to only include signals that have been closed (have exitPrice)
    return results.filter((s) => s.exitPrice !== null);
  },

  // === POLYMARKET ENHANCED SIGNAL GENERATION ===

  async generateEnhancedSignalFromNews(
    article: ArticleInput,
    userId: string,
    userPreferences: UserPreferences
  ): Promise<EnhancedSignalResult> {
    const { polymarketCorrelationService } = await import(
      "../polymarket-correlation.service"
    );
    const { openaiService } = await import("../llm");

    // 1. Определяем релевантный символ
    const symbols = article.symbols || [];
    const primarySymbol = symbols[0] || userPreferences.watchlist?.[0];

    if (!primarySymbol) {
      return { created: false, reason: "No relevant symbol found" };
    }

    // 2. Строим Polymarket контекст
    const polymarketContext =
      await polymarketCorrelationService.buildContextForSymbol(primarySymbol);

    // 3. Анализируем с учетом Polymarket
    const analysis = await openaiService.analyzeNewsWithPolymarket(
      article,
      polymarketContext
    );

    // 4. Генерируем базовый сигнал
    const baseSignal = openaiService.generateSignalFromAnalysis(
      analysis.result,
      userPreferences
    );

    if (!(baseSignal.shouldCreateSignal && baseSignal.signalParams)) {
      return {
        created: false,
        reason: "Base analysis did not warrant signal",
        analysis: analysis.result,
      };
    }

    // 5. Валидируем через Polymarket
    const validation = openaiService.validateSignalWithPolymarket(
      baseSignal.signalParams,
      polymarketContext
    );

    // 6. Принимаем решение на основе валидации
    if (validation.recommendedAction === "reconsider") {
      return {
        created: false,
        reason: `Polymarket divergence: ${validation.divergenceExplanation}`,
        analysis: analysis.result,
        validation,
      };
    }

    // 7. Корректируем strength на основе alignment
    const adjustedStrength = openaiService.adjustSignalStrength(
      baseSignal.signalParams.strength,
      analysis.result.polymarketAlignment,
      validation.divergenceLevel
    );

    // 8. Минимальный порог после корректировки
    if (adjustedStrength < 40) {
      return {
        created: false,
        reason: `Strength too low after Polymarket adjustment: ${adjustedStrength}`,
        analysis: analysis.result,
        validation,
      };
    }

    // 9. Создаем сигнал с расширенными метаданными
    const newSignal = await this.create({
      userId,
      symbol: baseSignal.signalParams.symbol,
      side: baseSignal.signalParams.side,
      strength: adjustedStrength,
      reasoning: baseSignal.signalParams.reasoning,
      metadata: {
        polymarketContext: {
          events: polymarketContext.events.map((e) => ({
            title: e.title,
            probability: e.probability,
            change24h: e.probabilityChange24h,
          })),
          alignment: analysis.result.polymarketAlignment,
          validation,
        },
        originalStrength: baseSignal.signalParams.strength,
        confidenceAdjustment: analysis.result.confidenceAdjustment,
        smartMoneySignal: analysis.result.smartMoneySignal,
      },
    });

    return {
      created: true,
      signal: newSignal,
      analysis: analysis.result,
      validation,
    };
  },
};

// Типы для enhanced signal generation
import type {
  ArticleInput,
  EnhancedAnalysisResult,
  PolymarketValidation,
  UserPreferences,
} from "../llm/types";

export interface EnhancedSignalResult {
  created: boolean;
  reason?: string;
  signal?: Signal;
  analysis?: EnhancedAnalysisResult;
  validation?: PolymarketValidation;
}
