import type { InferSelectModel } from "drizzle-orm";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import {
  marketAsset,
  marketCandle,
  marketIndicator,
  marketOpportunity,
  marketTrend,
} from "../schema/market";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type MarketAsset = InferSelectModel<typeof marketAsset>;
export type MarketCandle = InferSelectModel<typeof marketCandle>;
export type MarketIndicator = InferSelectModel<typeof marketIndicator>;
export type MarketTrend = InferSelectModel<typeof marketTrend>;
export type MarketOpportunity = InferSelectModel<typeof marketOpportunity>;

type MarketType = "crypto" | "etf" | "stock" | "moex" | "forex" | "commodity";
type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
type TrendType =
  | "uptrend"
  | "downtrend"
  | "sideways"
  | "breakout_up"
  | "breakout_down"
  | "reversal_bullish"
  | "reversal_bearish";
type TrendStrength = "weak" | "moderate" | "strong" | "very_strong";
type IndicatorType =
  | "rsi"
  | "macd"
  | "bollinger"
  | "ema"
  | "sma"
  | "adx"
  | "atr"
  | "volume_profile"
  | "support_resistance";

export interface AssetFilters extends PaginationParams {
  marketType?: MarketType;
  sector?: string;
  isActive?: boolean;
}

export interface CandleFilters {
  timeframe: Timeframe;
  limit?: number;
  startTime?: Date;
  endTime?: Date;
}

export interface IndicatorFilters {
  timeframe: Timeframe;
  types?: IndicatorType[];
  limit?: number;
}

export interface TrendFilters extends PaginationParams {
  marketType?: MarketType;
  trendType?: TrendType;
  strength?: TrendStrength;
  isActive?: boolean;
}

export interface OpportunityFilters extends PaginationParams {
  marketType?: MarketType;
  direction?: "long" | "short";
  minScore?: number;
  isActive?: boolean;
}

export interface HeatmapItem {
  symbol: string;
  sector: string;
  priceChange: number;
  volume: number;
}

export interface MarketSummary {
  totalAssets: number;
  byMarket: Record<string, number>;
  activeTrends: number;
  activeOpportunities: number;
}

class MarketRepository extends BaseRepository<typeof marketAsset> {
  constructor() {
    super(marketAsset);
  }

  // ===== Assets =====

  async findAssets(
    filters: AssetFilters
  ): Promise<PaginatedResult<MarketAsset>> {
    const {
      marketType,
      sector,
      isActive = true,
      limit = 100,
      offset = 0,
    } = filters;

    const conditions: SQL[] = [];
    if (isActive) conditions.push(eq(marketAsset.isActive, "true"));
    if (marketType) conditions.push(eq(marketAsset.marketType, marketType));
    if (sector) conditions.push(eq(marketAsset.sector, sector));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(marketAsset)
        .where(whereClause)
        .orderBy(marketAsset.symbol)
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(marketAsset).where(whereClause),
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

  async findAssetBySymbol(symbol: string): Promise<MarketAsset | null> {
    const [asset] = await this.db
      .select()
      .from(marketAsset)
      .where(eq(marketAsset.symbol, symbol.toUpperCase()))
      .limit(1);

    return asset ?? null;
  }

  async findAssetWithDetails(symbol: string): Promise<{
    asset: MarketAsset;
    indicators: MarketIndicator[];
    trend: MarketTrend | null;
    opportunity: MarketOpportunity | null;
  } | null> {
    const asset = await this.findAssetBySymbol(symbol);
    if (!asset) return null;

    const [indicators, [trend], [opportunity]] = await Promise.all([
      this.db
        .select()
        .from(marketIndicator)
        .where(eq(marketIndicator.assetId, asset.id))
        .orderBy(desc(marketIndicator.timestamp))
        .limit(10),
      this.db
        .select()
        .from(marketTrend)
        .where(
          and(
            eq(marketTrend.assetId, asset.id),
            eq(marketTrend.isActive, "true")
          )
        )
        .limit(1),
      this.db
        .select()
        .from(marketOpportunity)
        .where(
          and(
            eq(marketOpportunity.assetId, asset.id),
            eq(marketOpportunity.isActive, "true")
          )
        )
        .limit(1),
    ]);

    return {
      asset,
      indicators,
      trend: trend ?? null,
      opportunity: opportunity ?? null,
    };
  }

  // ===== Candles =====

  async findCandles(
    assetId: string,
    filters: CandleFilters
  ): Promise<MarketCandle[]> {
    const { timeframe, limit = 200, startTime, endTime } = filters;

    const conditions: SQL[] = [
      eq(marketCandle.assetId, assetId),
      eq(marketCandle.timeframe, timeframe),
    ];

    if (startTime) conditions.push(gte(marketCandle.openTime, startTime));
    if (endTime) conditions.push(lte(marketCandle.openTime, endTime));

    const candles = await this.db
      .select()
      .from(marketCandle)
      .where(and(...conditions))
      .orderBy(desc(marketCandle.openTime))
      .limit(limit);

    return candles.reverse();
  }

  // ===== Indicators =====

  async findIndicators(
    assetId: string,
    filters: IndicatorFilters
  ): Promise<MarketIndicator[]> {
    const { timeframe, types, limit = 100 } = filters;

    const conditions: SQL[] = [
      eq(marketIndicator.assetId, assetId),
      eq(marketIndicator.timeframe, timeframe),
    ];

    if (types?.length) {
      conditions.push(inArray(marketIndicator.indicatorType, types));
    }

    return this.db
      .select()
      .from(marketIndicator)
      .where(and(...conditions))
      .orderBy(desc(marketIndicator.timestamp))
      .limit(limit);
  }

  // ===== Trends =====

  async findTrends(
    filters: TrendFilters
  ): Promise<Array<MarketTrend & { asset: MarketAsset }>> {
    const {
      marketType,
      trendType,
      strength,
      isActive = true,
      limit = 50,
    } = filters;

    const conditions: SQL[] = [];
    if (isActive) conditions.push(eq(marketTrend.isActive, "true"));
    if (trendType) conditions.push(eq(marketTrend.trendType, trendType));
    if (strength) conditions.push(eq(marketTrend.strength, strength));
    if (marketType) conditions.push(eq(marketAsset.marketType, marketType));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const trends = await this.db
      .select({
        trend: marketTrend,
        asset: marketAsset,
      })
      .from(marketTrend)
      .innerJoin(marketAsset, eq(marketTrend.assetId, marketAsset.id))
      .where(whereClause)
      .orderBy(desc(marketTrend.createdAt))
      .limit(limit);

    return trends.map((t) => ({ ...t.trend, asset: t.asset }));
  }

  // ===== Opportunities =====

  async findOpportunities(
    filters: OpportunityFilters
  ): Promise<Array<MarketOpportunity & { asset: MarketAsset }>> {
    const {
      marketType,
      direction,
      minScore = 60,
      isActive = true,
      limit = 50,
    } = filters;

    const conditions: SQL[] = [gte(marketOpportunity.score, String(minScore))];
    if (isActive) conditions.push(eq(marketOpportunity.isActive, "true"));
    if (direction) conditions.push(eq(marketOpportunity.direction, direction));
    if (marketType) conditions.push(eq(marketAsset.marketType, marketType));

    const opportunities = await this.db
      .select({
        opportunity: marketOpportunity,
        asset: marketAsset,
      })
      .from(marketOpportunity)
      .innerJoin(marketAsset, eq(marketOpportunity.assetId, marketAsset.id))
      .where(and(...conditions))
      .orderBy(desc(marketOpportunity.score))
      .limit(limit);

    return opportunities.map((o) => ({ ...o.opportunity, asset: o.asset }));
  }

  // ===== Summary / Overview =====

  async getSummary(): Promise<MarketSummary> {
    const [assetsByMarket, trendsCount, opportunitiesCount] = await Promise.all(
      [
        this.db
          .select({
            marketType: marketAsset.marketType,
            count: sql<number>`count(*)`,
          })
          .from(marketAsset)
          .where(eq(marketAsset.isActive, "true"))
          .groupBy(marketAsset.marketType),
        this.db
          .select({ count: count() })
          .from(marketTrend)
          .where(eq(marketTrend.isActive, "true")),
        this.db
          .select({ count: count() })
          .from(marketOpportunity)
          .where(eq(marketOpportunity.isActive, "true")),
      ]
    );

    const byMarket = Object.fromEntries(
      assetsByMarket.map((m) => [m.marketType, Number(m.count)])
    );

    return {
      totalAssets: assetsByMarket.reduce((acc, m) => acc + Number(m.count), 0),
      byMarket,
      activeTrends: Number(trendsCount[0]?.count ?? 0),
      activeOpportunities: Number(opportunitiesCount[0]?.count ?? 0),
    };
  }

  async getTopOpportunities(
    limit = 5
  ): Promise<Array<MarketOpportunity & { asset: MarketAsset }>> {
    return this.findOpportunities({ isActive: true, limit });
  }

  async getRecentTrends(
    limit = 5
  ): Promise<Array<MarketTrend & { asset: MarketAsset }>> {
    return this.findTrends({ isActive: true, limit });
  }

  // ===== Heatmap (optimized) =====

  async getHeatmapData(): Promise<{
    data: HeatmapItem[];
    bySector: Record<string, HeatmapItem[]>;
  }> {
    // Single optimized query instead of N+1
    const result = await this.db
      .select({
        symbol: marketAsset.symbol,
        sector: marketAsset.sector,
        open: marketCandle.open,
        close: marketCandle.close,
        volume: marketCandle.volume,
      })
      .from(marketAsset)
      .innerJoin(
        marketCandle,
        and(
          eq(marketCandle.assetId, marketAsset.id),
          eq(marketCandle.timeframe, "1d")
        )
      )
      .where(eq(marketAsset.isActive, "true"))
      .orderBy(desc(marketCandle.openTime))
      .limit(1000); // Get recent candles

    // Group by symbol and take latest
    const symbolMap = new Map<string, HeatmapItem>();

    for (const row of result) {
      if (symbolMap.has(row.symbol)) continue;

      const open = Number(row.open);
      const close = Number(row.close);
      const priceChange = open > 0 ? ((close - open) / open) * 100 : 0;

      symbolMap.set(row.symbol, {
        symbol: row.symbol,
        sector: row.sector ?? "other",
        priceChange,
        volume: Number(row.volume),
      });
    }

    const data = Array.from(symbolMap.values());

    // Group by sector
    const bySector: Record<string, HeatmapItem[]> = {};
    for (const item of data) {
      if (!bySector[item.sector]) {
        bySector[item.sector] = [];
      }
      bySector[item.sector]!.push(item);
    }

    return { data, bySector };
  }
}

export const marketRepository = new MarketRepository();
