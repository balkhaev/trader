import {
  ADX,
  ATR,
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} from "technicalindicators";
import type {
  ADXResult,
  ATRResult,
  BollingerResult,
  EMAResult,
  IAnalyzer,
  IndicatorParams,
  MACDResult,
  OHLCV,
  RSIResult,
  SupportResistanceLevel,
  TechnicalAnalysisResult,
  Timeframe,
  TrendAnalysis,
  TrendStrength,
  TrendType,
} from "../types";

const DEFAULT_PARAMS: Required<IndicatorParams> = {
  rsiPeriod: 14,
  fastPeriod: 12,
  slowPeriod: 26,
  signalPeriod: 9,
  bollingerPeriod: 20,
  stdDev: 2,
  emaPeriods: [9, 21, 50, 200],
  smaPeriods: [20, 50, 200],
  adxPeriod: 14,
  atrPeriod: 14,
};

export class TechnicalAnalyzer implements IAnalyzer {
  private params: Required<IndicatorParams>;

  constructor(params?: IndicatorParams) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  /**
   * Полный технический анализ
   */
  async analyze(
    candles: OHLCV[],
    params?: IndicatorParams
  ): Promise<TechnicalAnalysisResult> {
    const mergedParams = { ...this.params, ...params };

    if (candles.length < 50) {
      throw new Error("Need at least 50 candles for analysis");
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);

    const [rsi, macd, bollinger, emas, adx, atr, supportResistance] =
      await Promise.all([
        this.calculateRSI(closes, mergedParams.rsiPeriod),
        this.calculateMACD(
          closes,
          mergedParams.fastPeriod,
          mergedParams.slowPeriod,
          mergedParams.signalPeriod
        ),
        this.calculateBollinger(
          closes,
          mergedParams.bollingerPeriod,
          mergedParams.stdDev
        ),
        this.calculateEMAs(closes, mergedParams.emaPeriods),
        this.calculateADX(highs, lows, closes, mergedParams.adxPeriod),
        this.calculateATR(highs, lows, closes, mergedParams.atrPeriod),
        this.findSupportResistance(candles),
      ]);

    const trend = this.analyzeTrend(candles, {
      rsi,
      macd,
      adx,
      emas,
      volumes,
      supportResistance,
    });

    const lastCandle = candles[candles.length - 1];

    return {
      symbol: "",
      timeframe: "1h" as Timeframe,
      timestamp: new Date(lastCandle?.timestamp ?? Date.now()),
      rsi,
      macd,
      bollinger,
      ema: emas,
      adx,
      atr,
      supportResistance,
      trend,
    };
  }

  /**
   * RSI (Relative Strength Index)
   */
  private async calculateRSI(
    closes: number[],
    period: number
  ): Promise<RSIResult | undefined> {
    const values = RSI.calculate({ values: closes, period });

    if (values.length === 0) return undefined;

    const value = values[values.length - 1] ?? 0;
    let signal: RSIResult["signal"] = "neutral";

    if (value <= 30) signal = "oversold";
    else if (value >= 70) signal = "overbought";

    return { value, signal };
  }

  /**
   * MACD (Moving Average Convergence Divergence)
   */
  private async calculateMACD(
    closes: number[],
    fastPeriod: number,
    slowPeriod: number,
    signalPeriod: number
  ): Promise<MACDResult | undefined> {
    const values = MACD.calculate({
      values: closes,
      fastPeriod,
      slowPeriod,
      signalPeriod,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });

    if (values.length === 0) return undefined;

    const last = values[values.length - 1];
    if (
      !last ||
      last.MACD === undefined ||
      last.signal === undefined ||
      last.histogram === undefined
    ) {
      return undefined;
    }

    let trend: MACDResult["trend"] = "neutral";
    if (last.histogram > 0 && last.MACD > last.signal) trend = "bullish";
    else if (last.histogram < 0 && last.MACD < last.signal) trend = "bearish";

    return {
      macd: last.MACD,
      signal: last.signal,
      histogram: last.histogram,
      trend,
    };
  }

  /**
   * Bollinger Bands
   */
  private async calculateBollinger(
    closes: number[],
    period: number,
    stdDev: number
  ): Promise<BollingerResult | undefined> {
    const values = BollingerBands.calculate({
      values: closes,
      period,
      stdDev,
    });

    if (values.length === 0) return undefined;

    const last = values[values.length - 1];
    if (!last) return undefined;

    const currentPrice = closes[closes.length - 1] ?? 0;
    const percentB = (currentPrice - last.lower) / (last.upper - last.lower);
    const bandwidth = (last.upper - last.lower) / last.middle;

    return {
      upper: last.upper,
      middle: last.middle,
      lower: last.lower,
      percentB,
      bandwidth,
    };
  }

  /**
   * EMA (Exponential Moving Average)
   */
  private async calculateEMAs(
    closes: number[],
    periods: number[]
  ): Promise<EMAResult[]> {
    const results: EMAResult[] = [];

    for (const period of periods) {
      const values = EMA.calculate({ values: closes, period });
      if (values.length > 0) {
        const value = values[values.length - 1];
        if (value !== undefined) {
          results.push({ value, period });
        }
      }
    }

    return results;
  }

  /**
   * ADX (Average Directional Index)
   */
  private async calculateADX(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): Promise<ADXResult | undefined> {
    const values = ADX.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });

    if (values.length === 0) return undefined;

    const last = values[values.length - 1];
    if (!last) return undefined;

    let trendStrength: TrendStrength = "weak";
    if (last.adx >= 50) trendStrength = "very_strong";
    else if (last.adx >= 25) trendStrength = "strong";
    else if (last.adx >= 20) trendStrength = "moderate";

    return {
      adx: last.adx,
      plusDI: last.pdi,
      minusDI: last.mdi,
      trendStrength,
    };
  }

  /**
   * ATR (Average True Range)
   */
  private async calculateATR(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number
  ): Promise<ATRResult | undefined> {
    const values = ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period,
    });

    if (values.length === 0) return undefined;

    const value = values[values.length - 1];
    if (value === undefined) return undefined;

    // Calculate ATR percentage
    const currentPrice = closes[closes.length - 1] ?? 1;
    const atrPercent = (value / currentPrice) * 100;

    let volatilityLevel: ATRResult["volatilityLevel"] = "medium";
    if (atrPercent < 2) volatilityLevel = "low";
    else if (atrPercent > 5) volatilityLevel = "high";

    return { value, volatilityLevel };
  }

  /**
   * Поиск уровней поддержки и сопротивления
   */
  private async findSupportResistance(
    candles: OHLCV[]
  ): Promise<SupportResistanceLevel[]> {
    const levels: SupportResistanceLevel[] = [];
    const pricePoints: {
      price: number;
      count: number;
      type: "support" | "resistance";
    }[] = [];

    // Находим локальные минимумы и максимумы
    for (let i = 2; i < candles.length - 2; i++) {
      const prev2 = candles[i - 2];
      const prev1 = candles[i - 1];
      const current = candles[i];
      const next1 = candles[i + 1];
      const next2 = candles[i + 2];

      if (!(prev2 && prev1 && current && next1 && next2)) continue;

      // Локальный минимум (поддержка)
      if (
        current.low < prev1.low &&
        current.low < prev2.low &&
        current.low < next1.low &&
        current.low < next2.low
      ) {
        this.addOrUpdateLevel(pricePoints, current.low, "support");
      }

      // Локальный максимум (сопротивление)
      if (
        current.high > prev1.high &&
        current.high > prev2.high &&
        current.high > next1.high &&
        current.high > next2.high
      ) {
        this.addOrUpdateLevel(pricePoints, current.high, "resistance");
      }
    }

    // Конвертируем в результат
    for (const point of pricePoints) {
      if (point.count >= 2) {
        levels.push({
          price: point.price,
          strength: Math.min(point.count / 5, 1),
          type: point.type,
          touches: point.count,
        });
      }
    }

    // Сортируем по цене
    return levels.sort((a, b) => a.price - b.price);
  }

  private addOrUpdateLevel(
    levels: { price: number; count: number; type: "support" | "resistance" }[],
    price: number,
    type: "support" | "resistance"
  ): void {
    const tolerance = price * 0.005; // 0.5% tolerance

    const existing = levels.find(
      (l) => l.type === type && Math.abs(l.price - price) < tolerance
    );

    if (existing) {
      existing.count++;
      existing.price = (existing.price + price) / 2; // Average
    } else {
      levels.push({ price, count: 1, type });
    }
  }

  /**
   * Анализ тренда
   */
  private analyzeTrend(
    candles: OHLCV[],
    indicators: {
      rsi?: RSIResult;
      macd?: MACDResult;
      adx?: ADXResult;
      emas: EMAResult[];
      volumes: number[];
      supportResistance: SupportResistanceLevel[];
    }
  ): TrendAnalysis | undefined {
    if (candles.length < 20) return undefined;

    const lastCandle = candles[candles.length - 1];
    const startCandle = candles[candles.length - 20];
    if (!(lastCandle && startCandle)) return undefined;

    const currentPrice = lastCandle.close;
    const startPrice = startCandle.close;
    const priceChange = ((currentPrice - startPrice) / startPrice) * 100;

    // Определяем тип тренда
    let type: TrendType = "sideways";
    if (priceChange > 5) type = "uptrend";
    else if (priceChange < -5) type = "downtrend";

    // Проверяем прорывы
    const nearestResistance = indicators.supportResistance.find(
      (l) => l.type === "resistance" && l.price > currentPrice * 0.98
    );
    const nearestSupport = indicators.supportResistance.find(
      (l) => l.type === "support" && l.price < currentPrice * 1.02
    );

    if (nearestResistance && currentPrice > nearestResistance.price) {
      type = "breakout_up";
    } else if (nearestSupport && currentPrice < nearestSupport.price) {
      type = "breakout_down";
    }

    // Проверяем развороты
    if (indicators.rsi) {
      if (indicators.rsi.signal === "oversold" && priceChange > 0) {
        type = "reversal_bullish";
      } else if (indicators.rsi.signal === "overbought" && priceChange < 0) {
        type = "reversal_bearish";
      }
    }

    // Определяем силу тренда
    let strength: TrendStrength = "weak";
    if (indicators.adx) {
      strength = indicators.adx.trendStrength;
    } else if (Math.abs(priceChange) > 15) {
      strength = "very_strong";
    } else if (Math.abs(priceChange) > 10) {
      strength = "strong";
    } else if (Math.abs(priceChange) > 5) {
      strength = "moderate";
    }

    // Рассчитываем уверенность
    let confidence = 0.5;
    if (indicators.adx && indicators.adx.adx > 25) confidence += 0.2;
    if (indicators.macd && indicators.macd.trend !== "neutral")
      confidence += 0.15;
    if (indicators.rsi && indicators.rsi.signal !== "neutral")
      confidence += 0.1;
    confidence = Math.min(confidence, 1);

    // Проверяем подтверждение объемом
    const recentVolumes = indicators.volumes.slice(-5);
    const avgVolume =
      indicators.volumes.reduce((a, b) => a + b, 0) / indicators.volumes.length;
    const recentAvgVolume =
      recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const volumeConfirmation = recentAvgVolume > avgVolume * 1.2;

    return {
      type,
      strength,
      confidence,
      startDate: new Date(startCandle.timestamp),
      priceChange,
      supportLevel: nearestSupport?.price,
      resistanceLevel: nearestResistance?.price,
      volumeConfirmation,
    };
  }

  /**
   * Быстрый расчет отдельных индикаторов
   */
  async quickRSI(closes: number[], period = 14): Promise<number | undefined> {
    const result = await this.calculateRSI(closes, period);
    return result?.value;
  }

  async quickMACD(
    closes: number[]
  ): Promise<{ macd: number; signal: number; histogram: number } | undefined> {
    const result = await this.calculateMACD(closes, 12, 26, 9);
    if (!result) return undefined;
    return {
      macd: result.macd,
      signal: result.signal,
      histogram: result.histogram,
    };
  }

  async quickEMA(
    closes: number[],
    period: number
  ): Promise<number | undefined> {
    const values = EMA.calculate({ values: closes, period });
    return values[values.length - 1];
  }

  async quickSMA(
    closes: number[],
    period: number
  ): Promise<number | undefined> {
    const values = SMA.calculate({ values: closes, period });
    return values[values.length - 1];
  }
}

// Singleton instance
export const technicalAnalyzer = new TechnicalAnalyzer();
