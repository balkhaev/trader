import type {
  marketAsset,
  marketCandle,
  marketCorrelation,
  marketIndicator,
  marketOpportunity,
  marketTrend,
} from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";

// ===== Database Types =====
export type MarketAsset = InferSelectModel<typeof marketAsset>;
export type MarketCandle = InferSelectModel<typeof marketCandle>;
export type MarketIndicator = InferSelectModel<typeof marketIndicator>;
export type MarketTrend = InferSelectModel<typeof marketTrend>;
export type MarketCorrelation = InferSelectModel<typeof marketCorrelation>;
export type MarketOpportunity = InferSelectModel<typeof marketOpportunity>;

// ===== Enums =====
export type MarketType =
  | "crypto"
  | "etf"
  | "stock"
  | "moex"
  | "forex"
  | "commodity";
export type DataSource =
  | "binance"
  | "bybit"
  | "yahoo"
  | "alpaca"
  | "moex_iss"
  | "tinkoff";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
export type IndicatorType =
  | "rsi"
  | "macd"
  | "bollinger"
  | "ema"
  | "sma"
  | "adx"
  | "atr"
  | "volume_profile"
  | "support_resistance";
export type TrendType =
  | "uptrend"
  | "downtrend"
  | "sideways"
  | "breakout_up"
  | "breakout_down"
  | "reversal_bullish"
  | "reversal_bearish";
export type TrendStrength = "weak" | "moderate" | "strong" | "very_strong";
export type OpportunityType =
  | "trend_following"
  | "mean_reversion"
  | "breakout"
  | "momentum";
export type Direction = "long" | "short";

// ===== Collector Types =====
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume?: number;
  trades?: number;
}

export interface AssetInfo {
  symbol: string;
  name: string;
  baseCurrency: string;
  quoteCurrency: string;
  marketType: MarketType;
  dataSource: DataSource;
  sector?: string;
  metadata?: Record<string, unknown>;
}

export interface CollectorConfig {
  dataSource: DataSource;
  symbols?: string[];
  timeframes?: Timeframe[];
  limit?: number;
}

export interface CollectorResult {
  asset: AssetInfo;
  candles: OHLCV[];
  timeframe: Timeframe;
  fetchedAt: Date;
}

export interface ICollector {
  readonly name: string;
  readonly dataSource: DataSource;

  fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit?: number
  ): Promise<OHLCV[]>;
  fetchTopSymbols(limit?: number): Promise<string[]>;
  getAssetInfo(symbol: string): Promise<AssetInfo>;
}

// ===== Analyzer Types =====
export interface RSIResult {
  value: number;
  signal: "oversold" | "overbought" | "neutral";
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  trend: "bullish" | "bearish" | "neutral";
}

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  percentB: number; // Position within bands (0-1)
  bandwidth: number;
}

export interface EMAResult {
  value: number;
  period: number;
}

export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
  trendStrength: TrendStrength;
}

export interface ATRResult {
  value: number;
  volatilityLevel: "low" | "medium" | "high";
}

export interface SupportResistanceLevel {
  price: number;
  strength: number;
  type: "support" | "resistance";
  touches: number;
}

export interface TrendAnalysis {
  type: TrendType;
  strength: TrendStrength;
  confidence: number;
  startDate: Date;
  priceChange: number;
  supportLevel?: number;
  resistanceLevel?: number;
  volumeConfirmation: boolean;
}

export interface TechnicalAnalysisResult {
  symbol: string;
  timeframe: Timeframe;
  timestamp: Date;
  rsi?: RSIResult;
  macd?: MACDResult;
  bollinger?: BollingerResult;
  ema?: EMAResult[];
  adx?: ADXResult;
  atr?: ATRResult;
  supportResistance?: SupportResistanceLevel[];
  trend?: TrendAnalysis;
}

export interface IndicatorParams {
  // RSI
  rsiPeriod?: number;
  // MACD
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  // Bollinger
  bollingerPeriod?: number;
  stdDev?: number;
  // EMA/SMA
  emaPeriods?: number[];
  smaPeriods?: number[];
  // ADX
  adxPeriod?: number;
  // ATR
  atrPeriod?: number;
}

export interface IAnalyzer {
  analyze(
    candles: OHLCV[],
    params?: IndicatorParams
  ): Promise<TechnicalAnalysisResult>;
}

// ===== Opportunity Types =====
export interface OpportunityInput {
  asset: MarketAsset;
  analysis: TechnicalAnalysisResult;
  currentPrice: number;
}

export interface OpportunityResult {
  type: OpportunityType;
  direction: Direction;
  score: number;
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
  riskRewardRatio?: number;
  reasoning: string;
  indicators: {
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    adx?: number;
    volumeChange?: number;
    priceChange24h?: number;
  };
  expiresAt?: Date;
}

// ===== API Types =====
export interface MarketOverview {
  totalAssets: number;
  byMarket: Record<MarketType, number>;
  activeTrends: number;
  opportunities: number;
  lastUpdated: Date;
}

export interface AssetWithAnalysis extends MarketAsset {
  latestCandle?: MarketCandle;
  indicators?: MarketIndicator[];
  activeTrend?: MarketTrend;
  opportunity?: MarketOpportunity;
}

export interface TrendSummary {
  asset: MarketAsset;
  trend: MarketTrend;
  currentPrice: number;
  priceChange: number;
}

export interface OpportunitySummary {
  asset: MarketAsset;
  opportunity: MarketOpportunity;
  currentPrice: number;
}

// ===== Scheduler Types =====
export interface SchedulerTask {
  name: string;
  cronExpression: string;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

export interface SchedulerConfig {
  tasks: {
    collectCandles1h: { interval: number; enabled: boolean };
    collectCandles4h: { interval: number; enabled: boolean };
    collectCandles1d: { interval: number; enabled: boolean };
    analyzeIndicators: { interval: number; enabled: boolean };
    detectTrends: { interval: number; enabled: boolean };
    findOpportunities: { interval: number; enabled: boolean };
  };
}
