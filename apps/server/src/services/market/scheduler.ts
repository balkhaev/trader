import {
  db,
  marketAsset,
  marketCandle,
  marketIndicator,
  marketOpportunity,
  marketTrend,
} from "@trader/db";
import { and, desc, eq } from "drizzle-orm";
import { technicalAnalyzer } from "./analyzers/technical.analyzer";
import { binanceCollector } from "./collectors/binance.collector";
import type {
  MarketAsset,
  OHLCV,
  OpportunityResult,
  TechnicalAnalysisResult,
  Timeframe,
} from "./types";

interface SchedulerState {
  isRunning: boolean;
  lastRun: Record<string, Date>;
  intervals: Record<string, ReturnType<typeof setInterval> | null>;
}

const state: SchedulerState = {
  isRunning: false,
  lastRun: {},
  intervals: {
    collect1h: null,
    collect4h: null,
    collect1d: null,
    analyze: null,
    trends: null,
    opportunities: null,
  },
};

// Интервалы в миллисекундах
const INTERVALS = {
  collect1h: 15 * 60 * 1000, // 15 минут
  collect4h: 60 * 60 * 1000, // 1 час
  collect1d: 6 * 60 * 60 * 1000, // 6 часов
  analyze: 15 * 60 * 1000, // 15 минут
  trends: 30 * 60 * 1000, // 30 минут
  opportunities: 30 * 60 * 1000, // 30 минут
};

export const marketScheduler = {
  /**
   * Запуск всех задач
   */
  start(): void {
    if (state.isRunning) {
      console.log("[MarketScheduler] Already running");
      return;
    }

    state.isRunning = true;
    console.log("[MarketScheduler] Starting...");

    // Сбор свечей
    state.intervals.collect1h = setInterval(
      () => this.collectCandles("1h"),
      INTERVALS.collect1h
    );
    state.intervals.collect4h = setInterval(
      () => this.collectCandles("4h"),
      INTERVALS.collect4h
    );
    state.intervals.collect1d = setInterval(
      () => this.collectCandles("1d"),
      INTERVALS.collect1d
    );

    // Анализ индикаторов
    state.intervals.analyze = setInterval(
      () => this.analyzeAllAssets(),
      INTERVALS.analyze
    );

    // Обнаружение трендов
    state.intervals.trends = setInterval(
      () => this.detectTrends(),
      INTERVALS.trends
    );

    // Поиск возможностей
    state.intervals.opportunities = setInterval(
      () => this.findOpportunities(),
      INTERVALS.opportunities
    );

    console.log("[MarketScheduler] Started all tasks");

    // Запускаем первичный сбор данных
    this.initialCollection();
  },

  /**
   * Остановка всех задач
   */
  stop(): void {
    if (!state.isRunning) {
      console.log("[MarketScheduler] Not running");
      return;
    }

    for (const [name, interval] of Object.entries(state.intervals)) {
      if (interval) {
        clearInterval(interval);
        state.intervals[name] = null;
      }
    }

    state.isRunning = false;
    console.log("[MarketScheduler] Stopped");
  },

  /**
   * Первичный сбор данных
   */
  async initialCollection(): Promise<void> {
    console.log("[MarketScheduler] Running initial collection...");

    try {
      // Сбор данных для всех таймфреймов
      await this.collectCandles("1d", 200);
      await this.collectCandles("4h", 200);
      await this.collectCandles("1h", 200);

      // Анализ
      await this.analyzeAllAssets();
      await this.detectTrends();
      await this.findOpportunities();

      console.log("[MarketScheduler] Initial collection completed");
    } catch (error) {
      console.error("[MarketScheduler] Initial collection failed:", error);
    }
  },

  /**
   * Сбор свечей для таймфрейма со всех источников
   */
  async collectCandles(timeframe: Timeframe, limit = 100): Promise<void> {
    const taskName = `collect${timeframe}`;
    console.log(
      `[MarketScheduler] Collecting ${timeframe} candles from all sources...`
    );

    let totalAssets = 0;
    let totalCandles = 0;

    try {
      // Binance (Crypto)
      const cryptoResult = await binanceCollector.collectTop(
        timeframe,
        50,
        limit
      );
      totalAssets += cryptoResult.totalAssets;
      totalCandles += cryptoResult.totalCandles;
      console.log(
        `[MarketScheduler] Binance: ${cryptoResult.totalCandles} candles`
      );
    } catch (error) {
      console.error("[MarketScheduler] Binance collection failed:", error);
    }

    try {
      // Yahoo Finance (ETF + SP500)
      const yahooResult = await yahooCollector.collectTop(timeframe, 40, limit);
      totalAssets += yahooResult.totalAssets;
      totalCandles += yahooResult.totalCandles;
      console.log(
        `[MarketScheduler] Yahoo: ${yahooResult.totalCandles} candles`
      );
    } catch (error) {
      console.error("[MarketScheduler] Yahoo collection failed:", error);
    }

    try {
      // MOEX (Russian stocks)
      const moexResult = await moexCollector.collectTop(timeframe, 25, limit);
      totalAssets += moexResult.totalAssets;
      totalCandles += moexResult.totalCandles;
      console.log(`[MarketScheduler] MOEX: ${moexResult.totalCandles} candles`);
    } catch (error) {
      console.error("[MarketScheduler] MOEX collection failed:", error);
    }

    state.lastRun[taskName] = new Date();

    console.log(
      `[MarketScheduler] Total: ${totalCandles} candles for ${totalAssets} assets (${timeframe})`
    );
  },

  /**
   * Сбор данных с конкретного источника
   */
  async collectFromSource(
    source: DataSource,
    timeframe: Timeframe,
    limit = 100
  ): Promise<{ totalAssets: number; totalCandles: number }> {
    console.log(`[MarketScheduler] Collecting from ${source}...`);

    switch (source) {
      case "binance":
        return binanceCollector.collectTop(timeframe, 50, limit);
      case "yahoo":
        return yahooCollector.collectTop(timeframe, 40, limit);
      case "moex_iss":
        return moexCollector.collectTop(timeframe, 25, limit);
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  },

  /**
   * Анализ всех активов
   */
  async analyzeAllAssets(): Promise<void> {
    console.log("[MarketScheduler] Analyzing all assets...");

    try {
      const assets = await db
        .select()
        .from(marketAsset)
        .where(eq(marketAsset.isActive, "true"));

      let analyzed = 0;

      for (const asset of assets) {
        try {
          await this.analyzeAsset(asset as MarketAsset, "1h");
          analyzed++;
        } catch (error) {
          console.error(
            `[MarketScheduler] Failed to analyze ${asset.symbol}:`,
            error
          );
        }
      }

      state.lastRun.analyze = new Date();
      console.log(`[MarketScheduler] Analyzed ${analyzed} assets`);
    } catch (error) {
      console.error("[MarketScheduler] Analysis failed:", error);
    }
  },

  /**
   * Анализ отдельного актива
   */
  async analyzeAsset(
    asset: MarketAsset,
    timeframe: Timeframe
  ): Promise<TechnicalAnalysisResult | null> {
    // Получаем свечи
    const candles = await db
      .select()
      .from(marketCandle)
      .where(
        and(
          eq(marketCandle.assetId, asset.id),
          eq(marketCandle.timeframe, timeframe)
        )
      )
      .orderBy(desc(marketCandle.openTime))
      .limit(200);

    if (candles.length < 50) {
      return null;
    }

    // Преобразуем в OHLCV и сортируем по времени
    const ohlcv: OHLCV[] = candles
      .map((c) => ({
        timestamp: c.openTime.getTime(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    // Анализируем
    const analysis = await technicalAnalyzer.analyze(ohlcv);
    analysis.symbol = asset.symbol;
    analysis.timeframe = timeframe;

    // Сохраняем индикаторы
    await this.saveIndicators(asset.id, timeframe, analysis);

    return analysis;
  },

  /**
   * Сохранение индикаторов в БД
   */
  async saveIndicators(
    assetId: string,
    timeframe: Timeframe,
    analysis: TechnicalAnalysisResult
  ): Promise<void> {
    const timestamp = analysis.timestamp;

    interface IndicatorData {
      assetId: string;
      timeframe: Timeframe;
      indicatorType:
        | "rsi"
        | "macd"
        | "bollinger"
        | "ema"
        | "sma"
        | "adx"
        | "atr"
        | "volume_profile"
        | "support_resistance";
      timestamp: Date;
      value: string | null;
      values: Record<string, unknown>;
      params: Record<string, number>;
    }

    const indicators: IndicatorData[] = [];

    if (analysis.rsi) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "rsi",
        timestamp,
        value: String(analysis.rsi.value),
        values: { signal: analysis.rsi.signal },
        params: { period: 14 },
      });
    }

    if (analysis.macd) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "macd",
        timestamp,
        value: String(analysis.macd.macd),
        values: {
          macd: analysis.macd.macd,
          signal: analysis.macd.signal,
          histogram: analysis.macd.histogram,
        },
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
      });
    }

    if (analysis.bollinger) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "bollinger",
        timestamp,
        value: String(analysis.bollinger.middle),
        values: {
          upper: analysis.bollinger.upper,
          middle: analysis.bollinger.middle,
          lower: analysis.bollinger.lower,
        },
        params: { period: 20, stdDev: 2 },
      });
    }

    if (analysis.adx) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "adx",
        timestamp,
        value: String(analysis.adx.adx),
        values: {
          plusDI: analysis.adx.plusDI,
          minusDI: analysis.adx.minusDI,
        },
        params: { period: 14 },
      });
    }

    if (analysis.atr) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "atr",
        timestamp,
        value: String(analysis.atr.value),
        values: { volatilityLevel: analysis.atr.volatilityLevel },
        params: { period: 14 },
      });
    }

    if (analysis.supportResistance && analysis.supportResistance.length > 0) {
      indicators.push({
        assetId,
        timeframe,
        indicatorType: "support_resistance",
        timestamp,
        value: null,
        values: { levels: analysis.supportResistance },
        params: {},
      });
    }

    // Upsert indicators
    for (const indicator of indicators) {
      try {
        await db
          .insert(marketIndicator)
          .values(indicator)
          .onConflictDoUpdate({
            target: [
              marketIndicator.assetId,
              marketIndicator.timeframe,
              marketIndicator.indicatorType,
              marketIndicator.timestamp,
            ],
            set: {
              value: indicator.value,
              values: indicator.values,
            },
          });
      } catch (error) {
        console.error("[MarketScheduler] Failed to save indicator:", error);
      }
    }
  },

  /**
   * Обнаружение трендов
   */
  async detectTrends(): Promise<void> {
    console.log("[MarketScheduler] Detecting trends...");

    try {
      const assets = await db
        .select()
        .from(marketAsset)
        .where(eq(marketAsset.isActive, "true"));

      let detected = 0;

      for (const asset of assets) {
        try {
          const analysis = await this.analyzeAsset(asset as MarketAsset, "4h");

          if (analysis?.trend) {
            await this.saveTrend(asset as MarketAsset, "4h", analysis);
            detected++;
          }
        } catch (error) {
          console.error(
            `[MarketScheduler] Failed to detect trend for ${asset.symbol}:`,
            error
          );
        }
      }

      state.lastRun.trends = new Date();
      console.log(`[MarketScheduler] Detected ${detected} trends`);
    } catch (error) {
      console.error("[MarketScheduler] Trend detection failed:", error);
    }
  },

  /**
   * Сохранение тренда
   */
  async saveTrend(
    asset: MarketAsset,
    timeframe: Timeframe,
    analysis: TechnicalAnalysisResult
  ): Promise<void> {
    if (!analysis.trend) return;

    const lastCandle = await db
      .select()
      .from(marketCandle)
      .where(
        and(
          eq(marketCandle.assetId, asset.id),
          eq(marketCandle.timeframe, timeframe)
        )
      )
      .orderBy(desc(marketCandle.openTime))
      .limit(1);

    const currentPrice = lastCandle[0] ? Number(lastCandle[0].close) : 0;

    // Деактивируем старые тренды
    await db
      .update(marketTrend)
      .set({ isActive: "false", endDate: new Date() })
      .where(
        and(
          eq(marketTrend.assetId, asset.id),
          eq(marketTrend.timeframe, timeframe),
          eq(marketTrend.isActive, "true")
        )
      );

    // Создаем новый тренд
    await db.insert(marketTrend).values({
      assetId: asset.id,
      timeframe,
      trendType: analysis.trend.type,
      strength: analysis.trend.strength,
      confidence: String(analysis.trend.confidence),
      startPrice: String(analysis.trend.priceChange),
      currentPrice: String(currentPrice),
      priceChange: String(analysis.trend.priceChange),
      startDate: analysis.trend.startDate,
      isActive: "true",
      metadata: {
        supportLevel: analysis.trend.supportLevel,
        resistanceLevel: analysis.trend.resistanceLevel,
        volumeConfirmation: analysis.trend.volumeConfirmation,
        indicatorSignals: {
          rsi: analysis.rsi?.signal,
          macd: analysis.macd?.trend,
          adx: analysis.adx?.adx,
        },
      },
    });
  },

  /**
   * Поиск инвестиционных возможностей
   */
  async findOpportunities(): Promise<void> {
    console.log("[MarketScheduler] Finding opportunities...");

    try {
      const assets = await db
        .select()
        .from(marketAsset)
        .where(eq(marketAsset.isActive, "true"));

      let found = 0;

      for (const asset of assets) {
        try {
          const opportunity = await this.evaluateOpportunity(
            asset as MarketAsset
          );

          if (opportunity && opportunity.score >= 60) {
            await this.saveOpportunity(asset as MarketAsset, opportunity);
            found++;
          }
        } catch (error) {
          console.error(
            `[MarketScheduler] Failed to evaluate ${asset.symbol}:`,
            error
          );
        }
      }

      state.lastRun.opportunities = new Date();
      console.log(`[MarketScheduler] Found ${found} opportunities`);
    } catch (error) {
      console.error("[MarketScheduler] Opportunity search failed:", error);
    }
  },

  /**
   * Оценка возможности для актива
   */
  async evaluateOpportunity(
    asset: MarketAsset
  ): Promise<OpportunityResult | null> {
    const analysis = await this.analyzeAsset(asset, "4h");
    if (!analysis) return null;

    const lastCandle = await db
      .select()
      .from(marketCandle)
      .where(eq(marketCandle.assetId, asset.id))
      .orderBy(desc(marketCandle.openTime))
      .limit(1);

    if (!lastCandle[0]) return null;

    const currentPrice = Number(lastCandle[0].close);
    let score = 50; // Базовый скор
    let direction: "long" | "short" = "long";
    let type: OpportunityResult["type"] = "momentum";
    const reasons: string[] = [];

    // RSI сигналы
    if (analysis.rsi) {
      if (analysis.rsi.signal === "oversold") {
        score += 15;
        direction = "long";
        type = "mean_reversion";
        reasons.push("RSI oversold");
      } else if (analysis.rsi.signal === "overbought") {
        score += 10;
        direction = "short";
        type = "mean_reversion";
        reasons.push("RSI overbought");
      }
    }

    // MACD сигналы
    if (analysis.macd) {
      if (analysis.macd.trend === "bullish" && analysis.macd.histogram > 0) {
        score += 10;
        if (direction === "long") score += 5;
        reasons.push("MACD bullish crossover");
      } else if (
        analysis.macd.trend === "bearish" &&
        analysis.macd.histogram < 0
      ) {
        score += 10;
        if (direction === "short") score += 5;
        reasons.push("MACD bearish crossover");
      }
    }

    // Trend signals
    if (analysis.trend) {
      if (
        analysis.trend.type === "uptrend" &&
        analysis.trend.strength !== "weak"
      ) {
        score += 10;
        type = "trend_following";
        direction = "long";
        reasons.push(`Strong uptrend (${analysis.trend.strength})`);
      } else if (
        analysis.trend.type === "downtrend" &&
        analysis.trend.strength !== "weak"
      ) {
        score += 10;
        type = "trend_following";
        direction = "short";
        reasons.push(`Strong downtrend (${analysis.trend.strength})`);
      } else if (analysis.trend.type === "breakout_up") {
        score += 20;
        type = "breakout";
        direction = "long";
        reasons.push("Breakout above resistance");
      } else if (analysis.trend.type === "breakout_down") {
        score += 15;
        type = "breakout";
        direction = "short";
        reasons.push("Breakout below support");
      }

      if (analysis.trend.volumeConfirmation) {
        score += 10;
        reasons.push("Volume confirmation");
      }
    }

    // ADX strength
    if (analysis.adx && analysis.adx.adx > 25) {
      score += 5;
      reasons.push(`Strong trend (ADX: ${analysis.adx.adx.toFixed(1)})`);
    }

    // Calculate targets
    let targetPrice: number | undefined;
    let stopLoss: number | undefined;

    if (analysis.atr) {
      const atr = analysis.atr.value;
      if (direction === "long") {
        targetPrice = currentPrice + atr * 2;
        stopLoss = currentPrice - atr * 1.5;
      } else {
        targetPrice = currentPrice - atr * 2;
        stopLoss = currentPrice + atr * 1.5;
      }
    }

    const riskRewardRatio =
      targetPrice && stopLoss
        ? Math.abs(targetPrice - currentPrice) /
          Math.abs(currentPrice - stopLoss)
        : undefined;

    return {
      type,
      direction,
      score: Math.min(score, 100),
      entryPrice: currentPrice,
      targetPrice,
      stopLoss,
      riskRewardRatio,
      reasoning: reasons.join(". "),
      indicators: {
        rsi: analysis.rsi?.value,
        macd: analysis.macd
          ? {
              value: analysis.macd.macd,
              signal: analysis.macd.signal,
              histogram: analysis.macd.histogram,
            }
          : undefined,
        adx: analysis.adx?.adx,
        priceChange24h: analysis.trend?.priceChange,
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };
  },

  /**
   * Сохранение возможности
   */
  async saveOpportunity(
    asset: MarketAsset,
    opportunity: OpportunityResult
  ): Promise<void> {
    // Деактивируем старые возможности
    await db
      .update(marketOpportunity)
      .set({ isActive: "false" })
      .where(
        and(
          eq(marketOpportunity.assetId, asset.id),
          eq(marketOpportunity.isActive, "true")
        )
      );

    // Создаем новую возможность
    await db.insert(marketOpportunity).values({
      assetId: asset.id,
      type: opportunity.type,
      direction: opportunity.direction,
      score: String(opportunity.score),
      entryPrice: String(opportunity.entryPrice),
      targetPrice: opportunity.targetPrice
        ? String(opportunity.targetPrice)
        : null,
      stopLoss: opportunity.stopLoss ? String(opportunity.stopLoss) : null,
      riskRewardRatio: opportunity.riskRewardRatio
        ? String(opportunity.riskRewardRatio)
        : null,
      timeframe: "4h",
      reasoning: opportunity.reasoning,
      indicators: opportunity.indicators,
      isActive: "true",
      expiresAt: opportunity.expiresAt,
    });
  },

  /**
   * Получение статуса
   */
  getStatus(): {
    isRunning: boolean;
    lastRun: Record<string, Date>;
    nextRun: Record<string, Date>;
  } {
    const nextRun: Record<string, Date> = {};

    for (const [name, interval] of Object.entries(INTERVALS)) {
      const lastRunTime = state.lastRun[name]?.getTime() || 0;
      nextRun[name] = new Date(lastRunTime + interval);
    }

    return {
      isRunning: state.isRunning,
      lastRun: state.lastRun,
      nextRun,
    };
  },
};
