// Base

// Agent
export type {
  Agent,
  AgentAllocation,
  AgentFilters,
  AgentPerformance,
  AgentStatus,
  AgentTrade,
  AllocationFilters,
  CreateAgentData,
  RiskLevel,
  StrategyType,
  TradeFilters,
} from "./agent.repository";
export { agentRepository } from "./agent.repository";
export type {
  PaginatedResult,
  PaginationParams,
  SortParams,
} from "./base.repository";
export { BaseRepository } from "./base.repository";

// Market
export type {
  AssetFilters,
  CandleFilters,
  HeatmapItem,
  IndicatorFilters,
  MarketAsset,
  MarketCandle,
  MarketIndicator,
  MarketOpportunity,
  MarketSummary,
  MarketTrend,
  OpportunityFilters,
  TrendFilters,
} from "./market.repository";
export { marketRepository } from "./market.repository";

// News
export type {
  ArticleFilters,
  ArticleStats,
  NewsAnalysis,
  NewsArticle,
  NewsSource,
  SourceFilters,
} from "./news.repository";
export { newsRepository } from "./news.repository";

// Prediction Market
export type {
  CreateMarketData,
  MarketCategory,
  MarketFilters,
  MarketOutcome,
  MarketPosition,
  MarketStatus,
  MarketTrade,
  PositionFilters,
  PositionSide,
  PredictionMarket,
} from "./prediction-market.repository";
export { predictionMarketRepository } from "./prediction-market.repository";

// Prediction Vector
export type {
  AgentPredictionStats,
  PredictionVector,
  PredictionVectorFilters,
  PredictionVectorStatus,
} from "./prediction-vector.repository";
export { predictionVectorRepository } from "./prediction-vector.repository";

// Signals
export type {
  Signal,
  SignalFilters,
  SignalStats,
  SignalStatus,
  SignalWithAnalyses,
} from "./signal.repository";
export { signalRepository } from "./signal.repository";
