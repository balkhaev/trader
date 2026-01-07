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
  newsContext?: { headlines: string[]; sentiment: number };
}

export interface RiskCheckResult {
  canTrade: boolean;
  reason?: string;
}

export const AGENT_DECISION_PROMPT = `You are an autonomous trading agent making decisions based on your strategy.

STRATEGY:
{strategy}

RISK PARAMETERS:
- Max position size: {maxPositionSize}% of capital
- Max drawdown allowed: {maxDrawdown}%
- Max daily loss: {maxDailyLoss}%
- Max open positions: {maxOpenPositions}
- Min time between trades: {minTimeBetweenTrades} seconds

CURRENT STATE:
- Open positions: {openPositions}
- Recent trades: {recentTrades}
- Current P&L: {currentPnL}%

MARKET DATA:
{marketData}

NEWS CONTEXT (if applicable):
{newsContext}

Based on your strategy and the current market conditions, should you:
1. OPEN a new position (long or short)
2. CLOSE an existing position
3. HOLD and do nothing

Respond with a JSON object containing:
- shouldTrade: boolean
- action: "long" | "short" | "close" | "hold"
- symbol: string (which symbol to trade, if applicable)
- quantity: number (as % of max position size, 0-100)
- reasoning: string (brief explanation of your decision)
- confidence: number (0-1, how confident you are)
- entryPrice: number (current market price)
- stopLoss: number (optional, price for stop loss)
- takeProfit: number (optional, price for take profit)

Be conservative with position sizing. Only trade when you have high conviction.`;
