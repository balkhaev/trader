import type { PositionSide, PredictionMarket } from "@trader/db";

/**
 * Automated Market Maker using simplified LMSR (Logarithmic Market Scoring Rule)
 *
 * This is a simplified implementation. In production, you'd want:
 * - More sophisticated price calculations
 * - Better handling of edge cases
 * - Slippage protection
 * - Minimum trade sizes
 */
class AMMService {
  /**
   * Calculate shares received for a buy order
   */
  calculateBuy(
    market: PredictionMarket,
    side: PositionSide,
    amount: number
  ): {
    shares: number;
    avgPrice: number;
    newYesPrice: number;
    priceImpact: number;
  } {
    const currentPrice =
      side === "yes" ? Number(market.yesPrice) : 100 - Number(market.yesPrice);

    const liquidity = Number(market.liquidity);

    // Simplified: shares = amount / price with slight discount for liquidity
    const baseShares = amount / (currentPrice / 100);

    // Apply price impact based on trade size relative to liquidity
    const impactFactor = 1 - (amount / liquidity) * 0.1;
    const shares = baseShares * Math.max(0.9, impactFactor);

    // Calculate average price
    const avgPrice = (amount / shares) * 100;

    // Calculate new price after trade
    // Price moves toward the side being bought
    const priceShift = (amount / liquidity) * 10; // Max 10% shift per trade
    let newYesPrice = Number(market.yesPrice);

    if (side === "yes") {
      newYesPrice = Math.min(99, newYesPrice + priceShift);
    } else {
      newYesPrice = Math.max(1, newYesPrice - priceShift);
    }

    const priceImpact = Math.abs(newYesPrice - Number(market.yesPrice));

    return {
      shares,
      avgPrice,
      newYesPrice,
      priceImpact,
    };
  }

  /**
   * Calculate proceeds from a sell order
   */
  calculateSell(
    market: PredictionMarket,
    side: PositionSide,
    shares: number
  ): {
    proceeds: number;
    avgPrice: number;
    newYesPrice: number;
    priceImpact: number;
  } {
    const currentPrice =
      side === "yes" ? Number(market.yesPrice) : 100 - Number(market.yesPrice);

    const liquidity = Number(market.liquidity);

    // Simplified: proceeds = shares * price with slight discount
    const baseProceeds = shares * (currentPrice / 100);

    // Apply liquidity discount
    const discountFactor = 1 - (baseProceeds / liquidity) * 0.1;
    const proceeds = baseProceeds * Math.max(0.9, discountFactor);

    // Calculate average price
    const avgPrice = (proceeds / shares) * 100;

    // Price moves opposite to sell side
    const priceShift = (proceeds / liquidity) * 10;
    let newYesPrice = Number(market.yesPrice);

    if (side === "yes") {
      newYesPrice = Math.max(1, newYesPrice - priceShift);
    } else {
      newYesPrice = Math.min(99, newYesPrice + priceShift);
    }

    const priceImpact = Math.abs(newYesPrice - Number(market.yesPrice));

    return {
      proceeds,
      avgPrice,
      newYesPrice,
      priceImpact,
    };
  }

  /**
   * Calculate expected payout if market resolves to given outcome
   */
  calculatePayout(
    shares: number,
    positionSide: PositionSide,
    outcome: "yes" | "no"
  ): number {
    if (positionSide === outcome) {
      // Winner gets $1 per share
      return shares;
    }
    // Loser gets nothing
    return 0;
  }

  /**
   * Get current price for a side
   */
  getPrice(market: PredictionMarket, side: PositionSide): number {
    return side === "yes"
      ? Number(market.yesPrice)
      : 100 - Number(market.yesPrice);
  }

  /**
   * Estimate slippage for a trade
   */
  estimateSlippage(
    market: PredictionMarket,
    side: PositionSide,
    amount: number
  ): number {
    const { avgPrice } = this.calculateBuy(market, side, amount);
    const currentPrice = this.getPrice(market, side);
    return Math.abs(avgPrice - currentPrice) / currentPrice;
  }
}

export const ammService = new AMMService();
