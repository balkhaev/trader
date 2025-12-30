import type {
  MarketAsset,
  MarketOpportunity,
  MarketSummary,
  MarketTrend,
  PaginatedResult,
  Signal,
  SignalStats,
} from "@trader/db";

// ===== Market Service =====

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";

export interface TechnicalAnalysis {
  symbol?: string;
  timeframe?: Timeframe;
  timestamp?: Date;
  rsi?: { value: number; signal: "oversold" | "overbought" | "neutral" };
  macd?: { macd: number; signal: number; histogram: number; trend: string };
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
  };
  adx?: { adx: number; plusDI: number; minusDI: number; trendStrength: string };
  atr?: { value: number; volatilityLevel: string };
  supportResistance?: Array<{
    price: number;
    strength: number;
    type: string;
    touches: number;
  }>;
}

export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketOverview {
  summary: MarketSummary;
  topOpportunities: Array<MarketOpportunity & { asset: MarketAsset }>;
  recentTrends: Array<MarketTrend & { asset: MarketAsset }>;
  scheduler: SchedulerStatus;
  lastUpdated: Date;
}

export interface SchedulerStatus {
  isRunning: boolean;
  lastRun: Record<string, Date>;
  nextRun: Record<string, Date>;
}

export interface IMarketService {
  getOverview(): Promise<MarketOverview>;
  analyze(
    symbol: string,
    timeframe: Timeframe
  ): Promise<{
    symbol: string;
    timeframe: Timeframe;
    currentPrice: number;
    change24h: {
      priceChange: number;
      priceChangePercent: number;
      volume: number;
    };
    analysis: TechnicalAnalysis;
  }>;
}

// ===== Signal Service =====

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

export interface ISignalService {
  create(params: CreateSignalParams): Promise<Signal>;
  approve(
    signalId: string,
    userId: string,
    params: ApproveSignalParams
  ): Promise<Order>;
  reject(signalId: string, userId: string, reason?: string): Promise<void>;
  expire(signalId: string): Promise<void>;
  getPending(userId: string): Promise<Signal[]>;
  getAll(
    userId: string,
    params?: { status?: string; limit?: number; offset?: number }
  ): Promise<Signal[]>;
  getById(signalId: string): Promise<Signal | undefined>;
  getStats(userId: string): Promise<SignalStats>;
}

// ===== Exchange Service =====

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";

export interface OrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price?: string;
  stopLoss?: string;
  takeProfit?: string;
}

export interface Order {
  orderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: string;
  price: string;
  status: string;
  createdAt: Date;
}

export interface Position {
  symbol: string;
  side: "long" | "short";
  size: string;
  entryPrice: string;
  markPrice: string;
  unrealizedPnl: string;
  leverage: string;
}

export interface Balance {
  coin: string;
  available: string;
  total: string;
  unrealizedPnl: string;
}

export interface IExchangeService {
  getBalance(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;
  createOrder(params: OrderParams): Promise<Order>;
  cancelOrder(symbol: string, orderId: string): Promise<void>;
  getOpenOrders(symbol?: string): Promise<Order[]>;
}

// ===== News Service =====

export interface FetchProgress {
  sourceId: string;
  status: "running" | "completed" | "failed";
  articlesFound: number;
  articlesSaved: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface INewsService {
  getSources(userId?: string): Promise<PaginatedResult<unknown>>;
  getArticles(params: {
    limit?: number;
    offset?: number;
    category?: string;
    symbols?: string[];
    hoursAgo?: number;
    sourceId?: string;
  }): Promise<unknown[]>;
  fetchSource(sourceId: string): Promise<FetchProgress>;
}

// ===== Transport Service =====

export interface TransportCollectResult {
  vesselsCollected: number;
  aircraftCollected: number;
  positionsRecorded: number;
  errors: string[];
}

export interface TransportSignal {
  id: string;
  type: string;
  direction: "bullish" | "bearish" | "neutral";
  commodity: string;
  affectedTickers: string[];
  description: string;
  severity: number;
  createdAt: Date;
}

export interface ITransportService {
  collectAll(): Promise<TransportCollectResult>;
  collectAircraft(): Promise<TransportCollectResult>;
  collectVessels(): Promise<TransportCollectResult>;
  getSignals(filters?: {
    commodity?: string;
    direction?: string;
  }): Promise<TransportSignal[]>;
  getOverview(): Promise<{
    vesselCount: number;
    aircraftCount: number;
    activeSignals: TransportSignal[];
    topCommodities: Record<string, number>;
    regionActivity: Record<string, number>;
  }>;
}

// ===== LLM Service =====

export interface LLMAnalysisResult {
  sentiment: string;
  sentimentScore: number;
  relevanceScore: number;
  impactScore: number;
  affectedAssets: Array<{
    symbol: string;
    impact: "positive" | "negative" | "neutral";
    confidence: number;
  }>;
  keyPoints: string[];
  marketImplications: string;
  recommendation: {
    action: "buy" | "sell" | "hold" | "monitor";
    symbols: string[];
    reasoning: string;
    timeframe: string;
    confidence: number;
    risks: string[];
  };
}

export interface ILLMService {
  analyzeNews(article: {
    title: string;
    content: string;
  }): Promise<LLMAnalysisResult>;
  extractTags(articleId: string): Promise<unknown>;
}
