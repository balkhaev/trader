import type { RiskParams } from "@trader/db/schema/agent";
import type { ExecutorContext, RiskCheckResult } from "./types";

/**
 * Risk Management Service
 *
 * Responsible for validating trade decisions against risk limits.
 * Checks max positions, time between trades, and daily loss limits.
 */
class RiskService {
  /**
   * Check if agent can trade within risk limits
   *
   * @param context - The execution context with agent state and positions
   * @returns Risk check result indicating if trading is allowed
   */
  checkRiskLimits(context: ExecutorContext): RiskCheckResult {
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
      const lastTrade = recentTrades[0];
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
}

export const riskService = new RiskService();
