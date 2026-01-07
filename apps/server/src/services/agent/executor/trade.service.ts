import type { Agent } from "@trader/db";
import { agentRepository } from "@trader/db";
import { logger } from "../../../lib/logger";
import type { TradeDecision } from "./types";

/**
 * Trade Execution Service
 *
 * Responsible for executing trade decisions.
 * Opens new positions, closes existing positions, and updates agent performance.
 */
class TradeService {
  private log = logger.child("trade");

  /**
   * Execute a trade decision for an agent
   *
   * @param agent - The agent executing the trade
   * @param decision - The trade decision to execute
   */
  async executeTrade(agent: Agent, decision: TradeDecision): Promise<void> {
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
}

export const tradeService = new TradeService();
