import {
  type AssetFilters,
  type CandleFilters,
  type HeatmapItem,
  type IndicatorFilters,
  type MarketAsset,
  type MarketIndicator,
  type MarketOpportunity,
  type MarketTrend,
  marketRepository,
  type OpportunityFilters,
  type PaginatedResult,
  type TrendFilters,
} from "@trader/db";
import { logger } from "../../lib/logger";
import type {
  IMarketService,
  MarketOverview,
  OHLCV,
  TechnicalAnalysis,
  Timeframe,
} from "../../types/services";
import { technicalAnalyzer } from "./analyzers/technical.analyzer";
import { binanceCollector } from "./collectors/binance.collector";
import { marketScheduler } from "./scheduler";

class MarketService implements IMarketService {
  private log = logger.child("market");

  // ===== Assets =====

  async getAssets(
    filters: AssetFilters
  ): Promise<PaginatedResult<MarketAsset>> {
    return marketRepository.findAssets(filters);
  }

  async getAssetBySymbol(symbol: string): Promise<{
    asset: MarketAsset;
    indicators: MarketIndicator[];
    trend: MarketTrend | null;
    opportunity: MarketOpportunity | null;
  } | null> {
    return marketRepository.findAssetWithDetails(symbol);
  }

  // ===== Candles =====

  async getCandles(
    symbol: string,
    filters: CandleFilters
  ): Promise<{
    symbol: string;
    timeframe: string;
    candles: OHLCV[];
  } | null> {
    const asset = await marketRepository.findAssetBySymbol(symbol);
    if (!asset) return null;

    const candles = await marketRepository.findCandles(asset.id, filters);

    return {
      symbol: asset.symbol,
      timeframe: filters.timeframe,
      candles: candles.map((c) => ({
        timestamp: c.openTime.getTime(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume),
      })),
    };
  }

  // ===== Indicators =====

  async getIndicators(
    symbol: string,
    filters: IndicatorFilters
  ): Promise<{
    symbol: string;
    timeframe: string;
    indicators: MarketIndicator[];
  } | null> {
    const asset = await marketRepository.findAssetBySymbol(symbol);
    if (!asset) return null;

    const indicators = await marketRepository.findIndicators(asset.id, filters);

    return {
      symbol: asset.symbol,
      timeframe: filters.timeframe,
      indicators,
    };
  }

  // ===== Trends =====

  async getTrends(
    filters: TrendFilters
  ): Promise<Array<MarketTrend & { asset: MarketAsset }>> {
    return marketRepository.findTrends(filters);
  }

  // ===== Opportunities =====

  async getOpportunities(
    filters: OpportunityFilters
  ): Promise<Array<MarketOpportunity & { asset: MarketAsset }>> {
    return marketRepository.findOpportunities(filters);
  }

  // ===== Overview =====

  async getOverview(): Promise<MarketOverview> {
    const [summary, topOpportunities, recentTrends] = await Promise.all([
      marketRepository.getSummary(),
      marketRepository.getTopOpportunities(5),
      marketRepository.getRecentTrends(5),
    ]);

    const schedulerStatus = marketScheduler.getStatus();

    return {
      summary,
      topOpportunities,
      recentTrends,
      scheduler: schedulerStatus,
      lastUpdated: new Date(),
    };
  }

  // ===== Heatmap =====

  async getHeatmap(): Promise<{
    data: HeatmapItem[];
    bySector: Record<string, HeatmapItem[]>;
  }> {
    return marketRepository.getHeatmapData();
  }

  // ===== Analysis =====

  async analyze(
    symbol: string,
    timeframe: Timeframe
  ): Promise<{
    symbol: string;
    timeframe: Timeframe;
    currentPrice: number;
    change24h: {
      priceChange: number;
      priceChangePercent: number;
      volume: number;
    };
    analysis: TechnicalAnalysis;
  }> {
    this.log.info("Analyzing symbol", { symbol, timeframe });

    // Fetch fresh data from Binance
    const candles = await binanceCollector.fetchOHLCV(
      symbol.toUpperCase(),
      timeframe,
      200
    );

    if (candles.length < 50) {
      throw new Error("Not enough data for analysis");
    }

    // Analyze
    const analysis = await technicalAnalyzer.analyze(candles);
    analysis.symbol = symbol.toUpperCase();
    analysis.timeframe = timeframe;

    // Get current price
    const currentPrice = await binanceCollector.getCurrentPrice(
      symbol.toUpperCase()
    );
    const change24h = await binanceCollector.get24hChange(symbol.toUpperCase());

    return {
      symbol: symbol.toUpperCase(),
      timeframe,
      currentPrice,
      change24h,
      analysis,
    };
  }

  // ===== Scheduler =====

  getSchedulerStatus() {
    return marketScheduler.getStatus();
  }

  startScheduler(): void {
    marketScheduler.start();
    this.log.info("Market scheduler started");
  }

  stopScheduler(): void {
    marketScheduler.stop();
    this.log.info("Market scheduler stopped");
  }

  // ===== Collection =====

  async collect(params: {
    timeframe: Timeframe;
    source: "binance" | "yahoo" | "moex_iss" | "all";
    topCount?: number;
    limit?: number;
  }): Promise<{ message: string; source: string }> {
    const { timeframe, source, limit = 200 } = params;

    this.log.info("Starting collection", { timeframe, source, limit });

    if (source === "all") {
      await marketScheduler.collectCandles(timeframe, limit);
      return {
        message: "Collection completed from all sources",
        source: "all",
      };
    }

    const result = await marketScheduler.collectFromSource(
      source,
      timeframe,
      limit
    );

    return {
      message: `Collection completed from ${source}`,
      source,
      ...result,
    };
  }

  // ===== Sources =====

  getSources() {
    return [
      {
        id: "binance",
        name: "Binance",
        description: "Криптовалюты - топ 50 по объёму",
        marketType: "crypto",
        enabled: true,
      },
      {
        id: "yahoo",
        name: "Yahoo Finance",
        description: "ETF и акции S&P 500",
        marketType: "etf,stock",
        enabled: true,
      },
      {
        id: "moex_iss",
        name: "MOEX ISS",
        description: "Московская биржа - голубые фишки",
        marketType: "moex",
        enabled: true,
      },
    ];
  }
}

export const marketService = new MarketService();
