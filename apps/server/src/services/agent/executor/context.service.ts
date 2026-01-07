import {
  type Agent,
  type AgentStrategy,
  agentRepository,
  marketRepository,
  type NewsArticle,
  newsRepository,
} from "@trader/db";
import type { ExecutorContext } from "./types";

/**
 * Context Builder Service
 *
 * Responsible for building execution context for trading agents.
 * Fetches open positions, recent trades, market data, and news context.
 */
class ContextService {
  /**
   * Build execution context for an agent
   *
   * @param agent - The agent to build context for
   * @returns Complete execution context with positions, trades, market data, and news
   */
  async buildContext(agent: Agent): Promise<ExecutorContext> {
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
        const candle = candles[0];
        marketData[symbol] = {
          price: Number(candle.close),
          change24h: 0, // Would calculate from previous candles
          volume: Number(candle.volume),
        };
      }
    }

    // Get news context if strategy uses news
    let newsContext: ExecutorContext["newsContext"];
    if (strategy.dataSources.includes("news")) {
      const { data: recentNews } = await newsRepository.findArticles({
        limit: 5,
      });

      newsContext = {
        headlines: recentNews.map((n: NewsArticle) => n.title),
        sentiment: 0, // Would calculate average sentiment
      };
    }

    return {
      agent,
      openPositions,
      recentTrades,
      marketData,
      newsContext,
    };
  }
}

export const contextService = new ContextService();
