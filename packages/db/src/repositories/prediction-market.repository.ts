import type { InferSelectModel } from "drizzle-orm";
import { and, count, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import {
  marketPosition,
  marketTrade,
  predictionMarket,
  type ResolutionCriteria,
} from "../schema/prediction-market";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type PredictionMarket = InferSelectModel<typeof predictionMarket>;
export type MarketPosition = InferSelectModel<typeof marketPosition>;
export type MarketTrade = InferSelectModel<typeof marketTrade>;

export type MarketCategory =
  | "macro"
  | "crypto"
  | "corporate"
  | "geo"
  | "commodity"
  | "other";
export type MarketStatus =
  | "pending"
  | "active"
  | "paused"
  | "resolved"
  | "cancelled";
export type MarketOutcome = "yes" | "no" | "cancelled";
export type PositionSide = "yes" | "no";

export interface MarketFilters extends PaginationParams {
  status?: MarketStatus;
  category?: MarketCategory;
  createdBy?: string;
  resolvesBefore?: Date;
  resolvesAfter?: Date;
}

export interface PositionFilters extends PaginationParams {
  userId?: string;
  agentId?: string;
  marketId?: string;
}

export interface CreateMarketData {
  question: string;
  description?: string;
  category: MarketCategory;
  resolutionCriteria: ResolutionCriteria;
  resolvesAt: Date;
  sourceArticleId?: string;
  createdBy?: string;
  creationType?: "ai" | "user" | "system";
  relatedSymbols?: string[];
  tags?: string[];
  metadata?: PredictionMarket["metadata"];
}

class PredictionMarketRepository extends BaseRepository<
  typeof predictionMarket
> {
  constructor() {
    super(predictionMarket);
  }

  // ===== Markets =====

  async findAll(
    filters: MarketFilters
  ): Promise<PaginatedResult<PredictionMarket>> {
    const {
      status,
      category,
      createdBy,
      resolvesBefore,
      resolvesAfter,
      limit = 50,
      offset = 0,
    } = filters;

    const conditions: SQL[] = [];
    if (status) conditions.push(eq(predictionMarket.status, status));
    if (category) conditions.push(eq(predictionMarket.category, category));
    if (createdBy) conditions.push(eq(predictionMarket.createdBy, createdBy));
    if (resolvesBefore)
      conditions.push(lte(predictionMarket.resolvesAt, resolvesBefore));
    if (resolvesAfter)
      conditions.push(gte(predictionMarket.resolvesAt, resolvesAfter));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(predictionMarket)
        .where(whereClause)
        .orderBy(desc(predictionMarket.totalVolume))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(predictionMarket)
        .where(whereClause),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async findById(id: string): Promise<PredictionMarket | null> {
    const [result] = await this.db
      .select()
      .from(predictionMarket)
      .where(eq(predictionMarket.id, id));
    return result ?? null;
  }

  async findActive(limit = 50): Promise<PredictionMarket[]> {
    return this.db
      .select()
      .from(predictionMarket)
      .where(eq(predictionMarket.status, "active"))
      .orderBy(desc(predictionMarket.totalVolume))
      .limit(limit);
  }

  async findTrending(limit = 10): Promise<PredictionMarket[]> {
    // Simple: highest volume in last 24h
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return this.db
      .select()
      .from(predictionMarket)
      .where(
        and(
          eq(predictionMarket.status, "active"),
          gte(predictionMarket.updatedAt, yesterday)
        )
      )
      .orderBy(desc(predictionMarket.totalVolume))
      .limit(limit);
  }

  async create(data: CreateMarketData): Promise<PredictionMarket> {
    const [market] = await this.db
      .insert(predictionMarket)
      .values({
        ...data,
        status: "pending",
        yesPrice: "50",
        liquidity: "1000",
        totalVolume: "0",
        yesShares: "0",
        noShares: "0",
      })
      .returning();
    return market!;
  }

  async activate(id: string): Promise<void> {
    await this.db
      .update(predictionMarket)
      .set({ status: "active" })
      .where(eq(predictionMarket.id, id));
  }

  async pause(id: string): Promise<void> {
    await this.db
      .update(predictionMarket)
      .set({ status: "paused" })
      .where(eq(predictionMarket.id, id));
  }

  async resolve(
    id: string,
    outcome: MarketOutcome,
    notes?: string
  ): Promise<PredictionMarket | null> {
    const [updated] = await this.db
      .update(predictionMarket)
      .set({
        status: "resolved",
        outcome,
        resolvedAt: new Date(),
        resolutionNotes: notes,
      })
      .where(eq(predictionMarket.id, id))
      .returning();
    return updated ?? null;
  }

  async cancel(id: string, notes?: string): Promise<void> {
    await this.db
      .update(predictionMarket)
      .set({
        status: "cancelled",
        outcome: "cancelled",
        resolvedAt: new Date(),
        resolutionNotes: notes,
      })
      .where(eq(predictionMarket.id, id));
  }

  async updatePrice(
    id: string,
    yesPrice: string,
    yesShares: string,
    noShares: string,
    volumeIncrease: string
  ): Promise<void> {
    const market = await this.findById(id);
    if (!market) return;

    const newVolume = Number(market.totalVolume) + Number(volumeIncrease);

    await this.db
      .update(predictionMarket)
      .set({
        yesPrice,
        yesShares,
        noShares,
        totalVolume: String(newVolume),
      })
      .where(eq(predictionMarket.id, id));
  }

  // ===== Positions =====

  async findPositions(
    filters: PositionFilters
  ): Promise<PaginatedResult<MarketPosition & { market: PredictionMarket }>> {
    const { userId, agentId, marketId, limit = 50, offset = 0 } = filters;

    const conditions: SQL[] = [];
    if (userId) conditions.push(eq(marketPosition.userId, userId));
    if (agentId) conditions.push(eq(marketPosition.agentId, agentId));
    if (marketId) conditions.push(eq(marketPosition.marketId, marketId));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select({
          position: marketPosition,
          market: predictionMarket,
        })
        .from(marketPosition)
        .innerJoin(
          predictionMarket,
          eq(marketPosition.marketId, predictionMarket.id)
        )
        .where(whereClause)
        .orderBy(desc(marketPosition.updatedAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(marketPosition)
        .where(whereClause),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: data.map((d) => ({ ...d.position, market: d.market })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async findPosition(
    marketId: string,
    userId: string,
    side: PositionSide
  ): Promise<MarketPosition | null> {
    const [result] = await this.db
      .select()
      .from(marketPosition)
      .where(
        and(
          eq(marketPosition.marketId, marketId),
          eq(marketPosition.userId, userId),
          eq(marketPosition.side, side)
        )
      );
    return result ?? null;
  }

  async upsertPosition(data: {
    marketId: string;
    userId?: string;
    agentId?: string;
    side: PositionSide;
    shares: string;
    avgPrice: string;
    totalCost: string;
  }): Promise<MarketPosition> {
    // Check if position exists
    if (data.userId) {
      const existing = await this.findPosition(
        data.marketId,
        data.userId,
        data.side
      );

      if (existing) {
        // Update existing position
        const newShares = Number(existing.shares) + Number(data.shares);
        const newTotalCost =
          Number(existing.totalCost) + Number(data.totalCost);
        const newAvgPrice = newTotalCost / newShares;

        const [updated] = await this.db
          .update(marketPosition)
          .set({
            shares: String(newShares),
            avgPrice: String(newAvgPrice.toFixed(2)),
            totalCost: String(newTotalCost),
          })
          .where(eq(marketPosition.id, existing.id))
          .returning();

        return updated!;
      }
    }

    // Create new position
    const [position] = await this.db
      .insert(marketPosition)
      .values(data)
      .returning();

    return position!;
  }

  async reducePosition(
    positionId: string,
    sharesToSell: string,
    _proceeds: string
  ): Promise<MarketPosition | null> {
    const position = await this.db
      .select()
      .from(marketPosition)
      .where(eq(marketPosition.id, positionId))
      .then((r) => r[0]);

    if (!position) return null;

    const newShares = Number(position.shares) - Number(sharesToSell);

    if (newShares <= 0) {
      // Close position
      await this.db
        .delete(marketPosition)
        .where(eq(marketPosition.id, positionId));
      return null;
    }

    const newTotalCost = newShares * Number(position.avgPrice);

    const [updated] = await this.db
      .update(marketPosition)
      .set({
        shares: String(newShares),
        totalCost: String(newTotalCost),
      })
      .where(eq(marketPosition.id, positionId))
      .returning();

    return updated ?? null;
  }

  async settlePosition(positionId: string, pnl: string): Promise<void> {
    await this.db
      .update(marketPosition)
      .set({
        realizedPnl: pnl,
      })
      .where(eq(marketPosition.id, positionId));
  }

  // ===== Trades =====

  async recordTrade(data: {
    marketId: string;
    userId?: string;
    agentId?: string;
    side: PositionSide;
    action: "buy" | "sell";
    shares: string;
    price: string;
    cost: string;
    priceBeforeTrade: string;
    priceAfterTrade: string;
  }): Promise<MarketTrade> {
    const [trade] = await this.db.insert(marketTrade).values(data).returning();
    return trade!;
  }

  async getTradeHistory(marketId: string, limit = 50): Promise<MarketTrade[]> {
    return this.db
      .select()
      .from(marketTrade)
      .where(eq(marketTrade.marketId, marketId))
      .orderBy(desc(marketTrade.createdAt))
      .limit(limit);
  }

  async getUserTrades(
    userId: string,
    limit = 50
  ): Promise<Array<MarketTrade & { market: PredictionMarket }>> {
    const data = await this.db
      .select({
        trade: marketTrade,
        market: predictionMarket,
      })
      .from(marketTrade)
      .innerJoin(
        predictionMarket,
        eq(marketTrade.marketId, predictionMarket.id)
      )
      .where(eq(marketTrade.userId, userId))
      .orderBy(desc(marketTrade.createdAt))
      .limit(limit);

    return data.map((d) => ({ ...d.trade, market: d.market }));
  }

  // ===== Stats =====

  async getStats(): Promise<{
    totalMarkets: number;
    activeMarkets: number;
    totalVolume: number;
    marketsByCategory: Record<string, number>;
  }> {
    const [all, active, byCategory] = await Promise.all([
      this.db.select({ count: count() }).from(predictionMarket),
      this.db
        .select({ count: count() })
        .from(predictionMarket)
        .where(eq(predictionMarket.status, "active")),
      this.db
        .select({
          category: predictionMarket.category,
          count: count(),
        })
        .from(predictionMarket)
        .groupBy(predictionMarket.category),
    ]);

    // Get total volume
    const markets = await this.db.select().from(predictionMarket);
    const totalVolume = markets.reduce(
      (sum, m) => sum + Number(m.totalVolume ?? 0),
      0
    );

    const marketsByCategory = Object.fromEntries(
      byCategory.map((c) => [c.category, Number(c.count)])
    );

    return {
      totalMarkets: Number(all[0]?.count ?? 0),
      activeMarkets: Number(active[0]?.count ?? 0),
      totalVolume,
      marketsByCategory,
    };
  }
}

export const predictionMarketRepository = new PredictionMarketRepository();
