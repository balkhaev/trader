import type { AgentStrategy } from "@trader/db";
import type { RiskParams } from "@trader/db/schema/agent";
import { logger } from "../../../lib/logger";
import { openaiService } from "../../llm/openai.service";
import { AGENT_DECISION_PROMPT, type ExecutorContext, type TradeDecision } from "./types";

/**
 * Decision Making Service
 *
 * Responsible for generating trade decisions using LLM.
 * Formats prompts with context, calls OpenAI, and parses JSON responses.
 */
class DecisionService {
  private log = logger.child("decision");

  /**
   * Get trade decision from LLM based on agent context
   *
   * @param context - The execution context with agent state, positions, and market data
   * @returns Trade decision with action, symbol, quantity, and reasoning
   */
  async getTradeDecision(context: ExecutorContext): Promise<TradeDecision> {
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
      .replace(
        "{newsContext}",
        newsContext
          ? `Headlines: ${newsContext.headlines.join(", ")}\nSentiment: ${newsContext.sentiment}`
          : "N/A"
      );

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
}

export const decisionService = new DecisionService();
