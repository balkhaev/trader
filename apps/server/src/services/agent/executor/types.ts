import type { Agent, AgentTrade } from "@trader/db";

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
