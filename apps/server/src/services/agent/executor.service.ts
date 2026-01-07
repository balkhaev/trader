import {
  type Agent,
  type AgentStrategy,
  type AgentTrade,
  agentRepository,
  marketRepository,
} from "@trader/db";
import type { RiskParams } from "@trader/db/schema/agent";
import { logger } from "../../lib/logger";
import { openaiService } from "../llm/openai.service";
import { contextBuilderService } from "./executor/context-builder.service";
import type { NewsContext, TradeDecision, ExecutorContext } from "./executor/types";

const AGENT_DECISION_PROMPT = `You are an autonomous trading agent making decisions based on your strategy.

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

class AgentExecutorService {
  private log = logger.child("executor");
  private executionIntervals: Map<string, ReturnType<typeof setInterval>> =
    new Map();

  /**
   * Start executing an agent's strategy
   */
  async startAgent(agentId: string): Promise<void> {
    const agent = await agentRepository.findById(agentId);
    if (!agent) {
      throw new Error("Agent not found");
    }

    if (agent.status !== "active") {
      throw new Error("Agent is not active");
    }

    if (this.executionIntervals.has(agentId)) {
      this.log.warn("Agent already running", { agentId });
      return;
    }

    this.log.info("Starting agent execution", {
      agentId,
      name: agent.name,
      strategy: agent.strategyType,
    });

    // Run immediately
    await this.executeAgent(agent);

    // Then run on interval (every 5 minutes)
    const interval = setInterval(
      () => {
        this.executeAgent(agent).catch((err) => {
          this.log.error("Execution error", {
            agentId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      5 * 60 * 1000
    );

    this.executionIntervals.set(agentId, interval);
  }

  /**
   * Stop an agent's execution
   */
  stopAgent(agentId: string): void {
    const interval = this.executionIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      this.executionIntervals.delete(agentId);
      this.log.info("Agent stopped", { agentId });
    }
  }

  /**
   * Execute a single cycle for an agent
   */
  async executeAgent(agent: Agent): Promise<TradeDecision | null> {
    this.log.debug("Executing agent cycle", { agentId: agent.id });

    try {
      // Build context
      const context = await this.buildContext(agent);

      // Check risk limits
      const riskCheck = this.checkRiskLimits(context);
      if (!riskCheck.canTrade) {
        this.log.info("Risk limits prevent trading", {
          agentId: agent.id,
          reason: riskCheck.reason,
        });
        return null;
      }

      // Get trade decision from LLM
      const decision = await this.getTradeDecision(context);

      if (!decision.shouldTrade || decision.action === "hold") {
        this.log.debug("Agent decided to hold", { agentId: agent.id });
        return decision;
      }

      // Execute the decision
      await this.executeTrade(agent, decision);

      return decision;
    } catch (error) {
      this.log.error("Agent execution failed", {
        agentId: agent.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Build execution context for an agent
   */
  private async buildContext(agent: Agent): Promise<ExecutorContext> {
    const [openPositions, recentTrades] = await Promise.all([
      agentRepository.getOpenTrades(agent.id),
      agentRepository.getRecentTrades(agent.id, 10),
    ]);

    // Get market data for strategy symbols
    const strategy = agent.strategy as AgentStrategy;
    const symbols = strategy.symbols ?? ["BTCUSDT", "ETHUSDT"];

    const marketData: ExecutorContext["marketData"] = {};
    for (const symbol of symbols) {
      // Get asset first
      const asset = await marketRepository.findAssetBySymbol(symbol);
      if (!asset) continue;

      // Get latest candle data
      const candles = await marketRepository.findCandles(asset.id, {
        timeframe: "1h",
        limit: 1,
      });

      if (candles.length > 0) {
        const candle = candles[0]!;
        marketData[symbol] = {
          price: Number(candle.close),
          change24h: 0, // Would calculate from previous candles
          volume: Number(candle.volume),
        };
      }
    }

    // Get enriched news context using context builder service
    const newsContext = await contextBuilderService.getNewsContext(strategy);

    this.log.debug("Context built", {
      agentId: agent.id,
      hasNews: newsContext !== undefined,
      headlineCount: newsContext?.headlines?.length ?? 0,
      hasAnalysis: (newsContext?.keyPoints?.length ?? 0) > 0 ||
        (newsContext?.recommendations?.length ?? 0) > 0,
      hasTrend: newsContext?.sentimentTrend !== undefined,
    });

    return {
      agent,
      openPositions,
      recentTrades,
      marketData,
      newsContext,
    };
  }

  /**
   * Check if agent can trade within risk limits
   */
  private checkRiskLimits(context: ExecutorContext): {
    canTrade: boolean;
    reason?: string;
  } {
    const riskParams = context.agent.riskParams as RiskParams;
    const { openPositions, recentTrades } = context;

    // Check max open positions
    if (openPositions.length >= riskParams.maxOpenPositions) {
      return {
        canTrade: false,
        reason: `Max open positions (${riskParams.maxOpenPositions}) reached`,
      };
    }

    // Check min time between trades
    if (recentTrades.length > 0) {
      const lastTrade = recentTrades[0]!;
      const timeSinceLast = (Date.now() - lastTrade.openedAt.getTime()) / 1000;

      if (timeSinceLast < riskParams.minTimeBetweenTrades) {
        return {
          canTrade: false,
          reason: `Min time between trades not elapsed (${Math.floor(timeSinceLast)}s < ${riskParams.minTimeBetweenTrades}s)`,
        };
      }
    }

    // Check daily loss
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaysTrades = recentTrades.filter((t) => t.openedAt >= today);
    const todaysLoss = todaysTrades.reduce(
      (sum, t) => sum + Math.min(0, Number(t.pnlPercent ?? 0)),
      0
    );

    if (Math.abs(todaysLoss) >= riskParams.maxDailyLoss) {
      return {
        canTrade: false,
        reason: `Daily loss limit (${riskParams.maxDailyLoss}%) reached`,
      };
    }

    return { canTrade: true };
  }

  /**
   * Format news context for prompt including enriched data fields.
   * Includes headlines, sentiment, key points, recommendations,
   * affected assets, and sentiment trend when available.
   */
  private formatNewsContext(newsContext: NewsContext | undefined): string {
    if (!newsContext) {
      return "N/A";
    }

    const parts: string[] = [];

    // Headlines
    if (newsContext.headlines.length > 0) {
      parts.push(`Headlines:\n${newsContext.headlines.map((h) => `- ${h}`).join("\n")}`);
    }

    // Sentiment with trend
    let sentimentStr = `Overall Sentiment: ${newsContext.sentiment.toFixed(2)}`;
    if (newsContext.sentimentTrend) {
      const { direction, change, period } = newsContext.sentimentTrend;
      const changeStr = change >= 0 ? `+${change.toFixed(2)}` : change.toFixed(2);
      sentimentStr += ` (${direction} ${changeStr} over ${period})`;
    }
    parts.push(sentimentStr);

    // Key points
    if (newsContext.keyPoints && newsContext.keyPoints.length > 0) {
      parts.push(`Key Points:\n${newsContext.keyPoints.map((p) => `- ${p}`).join("\n")}`);
    }

    // Recommendations
    if (newsContext.recommendations && newsContext.recommendations.length > 0) {
      const recsStr = newsContext.recommendations
        .map((r) => `- ${r.action.toUpperCase()} ${r.symbols.join(", ")}: ${r.reasoning}`)
        .join("\n");
      parts.push(`Recommendations:\n${recsStr}`);
    }

    // Affected assets
    if (newsContext.affectedAssets && newsContext.affectedAssets.length > 0) {
      const assetsStr = newsContext.affectedAssets
        .map((a) => `- ${a.symbol}: ${a.impact} (confidence: ${(a.confidence * 100).toFixed(0)}%)`)
        .join("\n");
      parts.push(`Affected Assets:\n${assetsStr}`);
    }

    return parts.join("\n\n");
  }

  /**
   * Get trade decision from LLM
   */
  private async getTradeDecision(
    context: ExecutorContext
  ): Promise<TradeDecision> {
    const { agent, openPositions, recentTrades, marketData, newsContext } =
      context;

    const strategy = agent.strategy as AgentStrategy;
    const riskParams = agent.riskParams as RiskParams;

    // Format market data for prompt
    const marketDataStr = Object.entries(marketData)
      .map(
        ([sym, data]) =>
          `${sym}: $${data.price.toFixed(2)} (${data.change24h >= 0 ? "+" : ""}${data.change24h.toFixed(2)}%)`
      )
      .join("\n");

    // Format positions
    const positionsStr =
      openPositions.length > 0
        ? openPositions
            .map(
              (p) => `${p.symbol} ${p.side}: ${p.quantity} @ $${p.entryPrice}`
            )
            .join("\n")
        : "No open positions";

    // Calculate current P&L
    const currentPnL = recentTrades.reduce(
      (sum, t) => sum + Number(t.pnlPercent ?? 0),
      0
    );

    const prompt = AGENT_DECISION_PROMPT.replace(
      "{strategy}",
      JSON.stringify(strategy, null, 2)
    )
      .replace("{maxPositionSize}", String(riskParams.maxPositionSize))
      .replace("{maxDrawdown}", String(riskParams.maxDrawdown))
      .replace("{maxDailyLoss}", String(riskParams.maxDailyLoss))
      .replace("{maxOpenPositions}", String(riskParams.maxOpenPositions))
      .replace(
        "{minTimeBetweenTrades}",
        String(riskParams.minTimeBetweenTrades)
      )
      .replace("{openPositions}", positionsStr)
      .replace("{recentTrades}", JSON.stringify(recentTrades.slice(0, 5)))
      .replace("{currentPnL}", currentPnL.toFixed(2))
      .replace("{marketData}", marketDataStr)
      .replace("{newsContext}", this.formatNewsContext(newsContext));

    try {
      const response = await openaiService.chat({
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: "Analyze and make your trading decision.",
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.3, // Lower temperature for more consistent decisions
      });

      const decision = JSON.parse(response.content ?? "{}") as TradeDecision;

      this.log.info("Trade decision made", {
        agentId: agent.id,
        action: decision.action,
        symbol: decision.symbol,
        confidence: decision.confidence,
      });

      return decision;
    } catch (error) {
      this.log.error("Failed to get trade decision", {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        shouldTrade: false,
        action: "hold",
        symbol: "",
        quantity: 0,
        entryPrice: 0,
        reasoning: "Error getting decision",
        confidence: 0,
        dataSources: {},
      };
    }
  }

  /**
   * Execute a trade decision
   */
  private async executeTrade(
    agent: Agent,
    decision: TradeDecision
  ): Promise<void> {
    if (!decision.shouldTrade || decision.action === "hold") {
      return;
    }

    if (decision.action === "close") {
      // Close existing position
      const openPositions = await agentRepository.getOpenTrades(agent.id);
      const position = openPositions.find((p) => p.symbol === decision.symbol);

      if (position) {
        const pnl =
          (decision.entryPrice - Number(position.entryPrice)) *
          Number(position.quantity);
        const pnlPercent =
          ((decision.entryPrice - Number(position.entryPrice)) /
            Number(position.entryPrice)) *
          100;

        await agentRepository.closeTrade(
          position.id,
          String(decision.entryPrice),
          String(pnl),
          String(pnlPercent)
        );

        this.log.info("Position closed", {
          agentId: agent.id,
          symbol: decision.symbol,
          pnl,
          pnlPercent,
        });
      }
    } else if (decision.action === "long" || decision.action === "short") {
      // Open new position
      const trade = await agentRepository.createTrade({
        agentId: agent.id,
        symbol: decision.symbol,
        side: decision.action,
        quantity: String(decision.quantity),
        entryPrice: String(decision.entryPrice),
        stopLoss: decision.stopLoss ? String(decision.stopLoss) : undefined,
        takeProfit: decision.takeProfit
          ? String(decision.takeProfit)
          : undefined,
        reasoning: decision.reasoning,
        dataSources: decision.dataSources,
        confidence: String(decision.confidence),
      });

      this.log.info("Position opened", {
        agentId: agent.id,
        tradeId: trade.id,
        symbol: decision.symbol,
        side: decision.action,
        quantity: decision.quantity,
      });
    }

    // Update agent performance after trade
    await agentRepository.updatePerformance(agent.id, {
      totalReturn: agent.totalReturn ?? "0",
      monthlyReturn: agent.monthlyReturn ?? "0",
      sharpeRatio: agent.sharpeRatio ?? "0",
      maxDrawdown: agent.maxDrawdown ?? "0",
      winRate: agent.winRate ?? "0",
      totalTrades: (agent.totalTrades ?? 0) + 1,
      avgHoldingPeriodHours: agent.avgHoldingPeriodHours ?? "0",
    });
  }

  /**
   * Get status of all running agents
   */
  getRunningAgents(): string[] {
    return Array.from(this.executionIntervals.keys());
  }

  /**
   * Stop all running agents
   */
  stopAll(): void {
    for (const agentId of this.executionIntervals.keys()) {
      this.stopAgent(agentId);
    }
  }
}

export const agentExecutorService = new AgentExecutorService();
