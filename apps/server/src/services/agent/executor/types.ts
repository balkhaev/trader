import type { Agent, AgentTrade } from "@trader/db";

/**
 * Recommendation action from news analysis
 */
export type RecommendationAction = "buy" | "sell" | "hold" | "monitor";

/**
 * Impact type for affected assets
 */
export type ImpactType = "positive" | "negative" | "neutral";

/**
 * Sentiment trend direction
 */
export type SentimentDirection = "improving" | "declining" | "stable";

/**
 * Sentiment trend period
 */
export type SentimentPeriod = "1h" | "24h";

/**
 * Recommendation derived from news analysis
 */
export interface NewsRecommendation {
  action: RecommendationAction;
  symbols: string[];
  reasoning: string;
}

/**
 * Asset affected by news with impact assessment
 */
export interface AffectedAsset {
  symbol: string;
  impact: ImpactType;
  confidence: number;
}

/**
 * Sentiment trend comparing current vs previous period
 */
export interface SentimentTrend {
  direction: SentimentDirection;
  change: number; // -1 to 1
  period: SentimentPeriod;
}

/**
 * Enhanced news context for agent decision making.
 * Includes analysis data from LLM-processed news articles.
 */
export interface NewsContext {
  /** Recent news headlines */
  headlines: string[];
  /** Overall sentiment score (-1 to 1) */
  sentiment: number;
  /** Key points extracted from news analysis */
  keyPoints?: string[];
  /** Trading recommendations derived from news */
  recommendations?: NewsRecommendation[];
  /** Assets mentioned/affected by news with impact assessment */
  affectedAssets?: AffectedAsset[];
  /** Sentiment trend comparing current vs previous period */
  sentimentTrend?: SentimentTrend;
}

/**
 * Trade decision made by an agent
 */
export interface TradeDecision {
  shouldTrade: boolean;
  action: "long" | "short" | "close" | "hold";
  symbol: string;
  quantity: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  reasoning: string;
  confidence: number;
  dataSources: AgentTrade["dataSources"];
}

/**
 * Context built for agent execution
 */
export interface ExecutorContext {
  agent: Agent;
  openPositions: AgentTrade[];
  recentTrades: AgentTrade[];
  marketData: Record<
    string,
    { price: number; change24h: number; volume: number }
  >;
  newsContext?: NewsContext;
}
