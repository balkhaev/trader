import {
  type CreateMarketData,
  type MarketFilters,
  type MarketPosition,
  type MarketTrade,
  type PaginatedResult,
  type PositionSide,
  type PredictionMarket,
  predictionMarketRepository,
} from "@trader/db";
import { logger } from "../../lib/logger";
import { BadRequestError, NotFoundError } from "../../middleware";
import { ammService } from "./amm.service";

class MarketService {
  private log = logger.child("market");

  // ===== Markets =====

  async getAll(
    filters: MarketFilters
  ): Promise<PaginatedResult<PredictionMarket>> {
    return predictionMarketRepository.findAll(filters);
  }

  async getById(id: string): Promise<PredictionMarket> {
    const market = await predictionMarketRepository.findById(id);
    if (!market) {
      throw new NotFoundError("Market");
    }
    return market;
  }

  async getActive(limit = 50): Promise<PredictionMarket[]> {
    return predictionMarketRepository.findActive(limit);
  }

  async getTrending(limit = 10): Promise<PredictionMarket[]> {
    return predictionMarketRepository.findTrending(limit);
  }

  async create(data: CreateMarketData): Promise<PredictionMarket> {
    const market = await predictionMarketRepository.create(data);

    this.log.info("Market created", {
      id: market.id,
      question: market.question.slice(0, 50),
      creationType: market.creationType,
    });

    return market;
  }

  async activate(id: string): Promise<void> {
    await this.getById(id); // Verify exists
    await predictionMarketRepository.activate(id);
    this.log.info("Market activated", { id });
  }

  async pause(id: string): Promise<void> {
    await this.getById(id);
    await predictionMarketRepository.pause(id);
    this.log.info("Market paused", { id });
  }

  async resolve(
    id: string,
    outcome: "yes" | "no",
    notes?: string
  ): Promise<PredictionMarket> {
    const market = await this.getById(id);

    if (market.status !== "active" && market.status !== "paused") {
      throw new BadRequestError("Market is not active");
    }

    const resolved = await predictionMarketRepository.resolve(
      id,
      outcome,
      notes
    );

    this.log.info("Market resolved", { id, outcome });

    // Settle positions
    await this.settlePositions(id, outcome);

    return resolved!;
  }

  /**
   * Settle all positions for a resolved market
   * Winners receive $1 per share, losers receive $0
   */
  async settlePositions(
    marketId: string,
    outcome: "yes" | "no"
  ): Promise<{
    totalPayouts: number;
    winningPositions: number;
    losingPositions: number;
  }> {
    const positions = await predictionMarketRepository.findPositions({
      marketId,
    });

    let totalPayouts = 0;
    let winningPositions = 0;
    let losingPositions = 0;

    for (const position of positions.data) {
      const shares = Number(position.shares);
      const isWinner = position.side === outcome;

      if (isWinner) {
        // Winners get $1 per share
        const payout = shares;
        const cost = Number(position.totalCost);
        const pnl = payout - cost;

        await predictionMarketRepository.settlePosition(
          position.id,
          String(pnl.toFixed(2))
        );

        totalPayouts += payout;
        winningPositions++;

        this.log.info("Position settled (win)", {
          positionId: position.id,
          userId: position.userId,
          payout,
          pnl,
        });
      } else {
        // Losers get $0
        const cost = Number(position.totalCost);
        const pnl = -cost;

        await predictionMarketRepository.settlePosition(
          position.id,
          String(pnl.toFixed(2))
        );

        losingPositions++;

        this.log.info("Position settled (loss)", {
          positionId: position.id,
          userId: position.userId,
          loss: cost,
        });
      }
    }

    this.log.info("Market positions settled", {
      marketId,
      outcome,
      totalPayouts,
      winningPositions,
      losingPositions,
    });

    return { totalPayouts, winningPositions, losingPositions };
  }

  async cancel(id: string, reason?: string): Promise<void> {
    await this.getById(id);
    await predictionMarketRepository.cancel(id, reason);
    this.log.info("Market cancelled", { id, reason });
  }

  // ===== Trading =====

  async buy(
    marketId: string,
    userId: string,
    side: PositionSide,
    amount: number
  ): Promise<{
    trade: MarketTrade;
    position: MarketPosition;
    newPrice: number;
  }> {
    const market = await this.getById(marketId);

    if (market.status !== "active") {
      throw new BadRequestError("Market is not active for trading");
    }

    if (amount <= 0) {
      throw new BadRequestError("Amount must be positive");
    }

    // Calculate shares and price impact using AMM
    const { shares, avgPrice, newYesPrice } = ammService.calculateBuy(
      market,
      side,
      amount
    );

    const priceBeforeTrade = Number(market.yesPrice);

    // Update market price
    const currentYesShares = Number(market.yesShares);
    const currentNoShares = Number(market.noShares);
    const newYesShares =
      side === "yes" ? currentYesShares + shares : currentYesShares;
    const newNoShares =
      side === "no" ? currentNoShares + shares : currentNoShares;

    await predictionMarketRepository.updatePrice(
      marketId,
      String(newYesPrice.toFixed(2)),
      String(newYesShares),
      String(newNoShares),
      String(amount)
    );

    // Create/update position
    const position = await predictionMarketRepository.upsertPosition({
      marketId,
      userId,
      side,
      shares: String(shares),
      avgPrice: String(avgPrice.toFixed(2)),
      totalCost: String(amount),
    });

    // Record trade
    const trade = await predictionMarketRepository.recordTrade({
      marketId,
      userId,
      side,
      action: "buy",
      shares: String(shares),
      price: String(avgPrice.toFixed(2)),
      cost: String(amount),
      priceBeforeTrade: String(priceBeforeTrade.toFixed(2)),
      priceAfterTrade: String(newYesPrice.toFixed(2)),
    });

    this.log.info("Trade executed", {
      marketId,
      userId,
      side,
      shares,
      amount,
      newPrice: newYesPrice,
    });

    return {
      trade,
      position,
      newPrice: newYesPrice,
    };
  }

  async sell(
    marketId: string,
    userId: string,
    side: PositionSide,
    shares: number
  ): Promise<{
    trade: MarketTrade;
    proceeds: number;
    newPrice: number;
  }> {
    const market = await this.getById(marketId);

    if (market.status !== "active") {
      throw new BadRequestError("Market is not active for trading");
    }

    // Find position
    const position = await predictionMarketRepository.findPosition(
      marketId,
      userId,
      side
    );

    if (!position || Number(position.shares) < shares) {
      throw new BadRequestError("Insufficient shares to sell");
    }

    // Calculate proceeds using AMM
    const { proceeds, newYesPrice } = ammService.calculateSell(
      market,
      side,
      shares
    );

    const priceBeforeTrade = Number(market.yesPrice);

    // Update market
    const currentYesShares = Number(market.yesShares);
    const currentNoShares = Number(market.noShares);
    const newYesShares =
      side === "yes" ? currentYesShares - shares : currentYesShares;
    const newNoShares =
      side === "no" ? currentNoShares - shares : currentNoShares;

    await predictionMarketRepository.updatePrice(
      marketId,
      String(newYesPrice.toFixed(2)),
      String(newYesShares),
      String(newNoShares),
      String(proceeds)
    );

    // Reduce position
    await predictionMarketRepository.reducePosition(
      position.id,
      String(shares),
      String(proceeds)
    );

    // Record trade
    const trade = await predictionMarketRepository.recordTrade({
      marketId,
      userId,
      side,
      action: "sell",
      shares: String(shares),
      price: String((proceeds / shares).toFixed(2)),
      cost: String(-proceeds), // Negative for sell
      priceBeforeTrade: String(priceBeforeTrade.toFixed(2)),
      priceAfterTrade: String(newYesPrice.toFixed(2)),
    });

    this.log.info("Sell executed", {
      marketId,
      userId,
      side,
      shares,
      proceeds,
      newPrice: newYesPrice,
    });

    return {
      trade,
      proceeds,
      newPrice: newYesPrice,
    };
  }

  // ===== Positions =====

  async getUserPositions(
    userId: string
  ): Promise<PaginatedResult<MarketPosition & { market: PredictionMarket }>> {
    return predictionMarketRepository.findPositions({ userId });
  }

  async getMarketPositions(
    marketId: string
  ): Promise<PaginatedResult<MarketPosition & { market: PredictionMarket }>> {
    return predictionMarketRepository.findPositions({ marketId });
  }

  // ===== Trade History =====

  async getMarketTrades(marketId: string, limit = 50): Promise<MarketTrade[]> {
    return predictionMarketRepository.getTradeHistory(marketId, limit);
  }

  async getUserTrades(
    userId: string,
    limit = 50
  ): Promise<Array<MarketTrade & { market: PredictionMarket }>> {
    return predictionMarketRepository.getUserTrades(userId, limit);
  }

  // ===== Stats =====

  async getStats(): Promise<{
    totalMarkets: number;
    activeMarkets: number;
    totalVolume: number;
    marketsByCategory: Record<string, number>;
  }> {
    return predictionMarketRepository.getStats();
  }
}

export const marketService = new MarketService();
