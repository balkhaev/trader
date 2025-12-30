import { db, polymarketAssetMapping, polymarketMarket } from "@trader/db";
import { desc, eq } from "drizzle-orm";
import { polymarketService } from "./polymarket.service";

// Типы для контекста LLM
export interface PolymarketEventContext {
  title: string;
  description: string;
  question: string;
  probability: number;
  probabilityChange24h: number;
  volume: number;
  volume24h: number;
  relevance: number;
  recentComments: string[];
  smartMoney: {
    sentiment: "bullish" | "bearish" | "neutral";
    topHoldersConcentration: number;
  } | null;
}

export interface PolymarketContext {
  events: PolymarketEventContext[];
  marketSentiment: {
    bullishEvents: number;
    bearishEvents: number;
    avgProbabilityChange: number;
  };
}

// Ключевые слова для символов
const SYMBOL_KEYWORDS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc", "crypto"],
  ETH: ["ethereum", "eth", "ether"],
  SOL: ["solana", "sol"],
  XRP: ["ripple", "xrp"],
  ADA: ["cardano", "ada"],
  DOGE: ["dogecoin", "doge"],
  AVAX: ["avalanche", "avax"],
  LINK: ["chainlink", "link"],
  DOT: ["polkadot", "dot"],
  MATIC: ["polygon", "matic"],
  BNB: ["binance", "bnb"],
  USDT: ["tether", "usdt"],
  USDC: ["usdc", "circle"],
};

export const polymarketCorrelationService = {
  /**
   * Автоопределение связи события с криптоактивами
   */
  async detectAssetMapping(eventId: string): Promise<void> {
    const event = await polymarketService.getStoredEventWithMarkets(eventId);
    if (!event) return;

    const textToAnalyze =
      `${event.title} ${event.description || ""}`.toLowerCase();

    const detectedMappings: Array<{
      symbol: string;
      relevance: number;
      direction: "positive" | "negative" | "mixed";
    }> = [];

    for (const [symbol, keywords] of Object.entries(SYMBOL_KEYWORDS)) {
      const matches = keywords.filter((kw) => textToAnalyze.includes(kw));

      if (matches.length > 0) {
        const relevance = Math.min(1, matches.length * 0.4);
        const direction = detectImpactDirection(textToAnalyze, symbol);

        detectedMappings.push({ symbol, relevance, direction });
      }
    }

    // Сохраняем маппинги
    for (const mapping of detectedMappings) {
      await db
        .insert(polymarketAssetMapping)
        .values({
          eventId,
          symbol: mapping.symbol,
          relevance: mapping.relevance,
          impactDirection: mapping.direction,
          autoDetected: true,
        })
        .onConflictDoNothing();
    }
  },

  /**
   * Построение контекста Polymarket для LLM анализа
   */
  async buildContextForSymbol(symbol: string): Promise<PolymarketContext> {
    const relevantEvents = await polymarketService.findRelevantEvents(symbol, {
      limit: 5,
      minVolume: 10_000,
    });

    const events: PolymarketEventContext[] = [];

    for (const { event, relevance } of relevantEvents) {
      // Получаем маркеты события
      const markets = await db
        .select()
        .from(polymarketMarket)
        .where(eq(polymarketMarket.eventId, event.id))
        .orderBy(desc(polymarketMarket.volume))
        .limit(1);

      const market = markets[0];
      if (!market) continue;

      // Получаем изменение вероятности
      const probabilityChange = await polymarketService.getProbabilityChanges(
        market.id,
        24
      );

      // Получаем комментарии
      const comments = await polymarketService.getRecentComments(event.id, 3);

      // Получаем holders для анализа smart money
      const holders = await polymarketService.getTopHolders(market.id, 10);
      const smartMoney = analyzeSmartMoney(holders);

      // Парсим вероятность из цен
      const probability = market.outcomePrices?.[0]
        ? Number.parseFloat(market.outcomePrices[0])
        : 0.5;

      events.push({
        title: event.title,
        description: event.description || "",
        question: market.question,
        probability,
        probabilityChange24h: probabilityChange?.change ?? 0,
        volume: event.volume || 0,
        volume24h: event.volume24hr || 0,
        relevance,
        recentComments: comments.map((c) => c.content).slice(0, 2),
        smartMoney,
      });
    }

    // Рассчитываем общий sentiment
    const bullishEvents = events.filter(
      (e) => e.probabilityChange24h > 0.02
    ).length;
    const bearishEvents = events.filter(
      (e) => e.probabilityChange24h < -0.02
    ).length;
    const avgProbabilityChange =
      events.length > 0
        ? events.reduce((sum, e) => sum + e.probabilityChange24h, 0) /
          events.length
        : 0;

    return {
      events,
      marketSentiment: {
        bullishEvents,
        bearishEvents,
        avgProbabilityChange,
      },
    };
  },

  /**
   * Анализ smart money по holders
   */
  analyzeSmartMoney(marketId: string): Promise<{
    sentiment: "bullish" | "bearish" | "neutral";
    topHoldersConcentration: number;
  } | null> {
    return polymarketService.getTopHolders(marketId, 10).then((holders) => {
      return analyzeSmartMoney(holders);
    });
  },

  /**
   * Обновление asset mappings для всех активных событий
   */
  async updateAssetMappings(): Promise<number> {
    const events = await polymarketService.getStoredEvents({
      active: true,
      closed: false,
      limit: 200,
    });

    let count = 0;
    for (const event of events) {
      await this.detectAssetMapping(event.id);
      count++;
    }

    return count;
  },

  /**
   * Форматирование контекста для LLM промпта
   */
  formatContextForPrompt(context: PolymarketContext): string {
    if (context.events.length === 0) {
      return "No relevant prediction market data available.";
    }

    let output = "=== PREDICTION MARKET CONTEXT ===\n\n";

    for (const [i, event] of context.events.entries()) {
      const changeSign = event.probabilityChange24h >= 0 ? "+" : "";
      const changePercent = (event.probabilityChange24h * 100).toFixed(2);

      output += `[Event ${i + 1}] ${event.title}\n`;
      output += `Question: ${event.question}\n`;
      output += `- Probability: ${(event.probability * 100).toFixed(1)}% (${changeSign}${changePercent}% 24h)\n`;
      output += `- Volume: $${formatNumber(event.volume)} (24h: $${formatNumber(event.volume24h)})\n`;
      output += `- Relevance: ${(event.relevance * 100).toFixed(0)}%\n`;

      if (event.smartMoney) {
        output += `- Smart Money: ${event.smartMoney.sentiment} (top 10 hold ${event.smartMoney.topHoldersConcentration.toFixed(0)}%)\n`;
      }

      if (event.recentComments.length > 0) {
        output += `- Recent comments: "${event.recentComments.join('", "')}"\n`;
      }

      output += "\n";
    }

    output += "Market Sentiment Summary:\n";
    output += `- Bullish events: ${context.marketSentiment.bullishEvents}\n`;
    output += `- Bearish events: ${context.marketSentiment.bearishEvents}\n`;
    const avgChangeSign =
      context.marketSentiment.avgProbabilityChange >= 0 ? "+" : "";
    output += `- Average probability change: ${avgChangeSign}${(context.marketSentiment.avgProbabilityChange * 100).toFixed(2)}%\n`;

    return output;
  },
};

// Хелперы

function detectImpactDirection(
  text: string,
  _symbol: string
): "positive" | "negative" | "mixed" {
  const positiveWords = [
    "rise",
    "increase",
    "above",
    "higher",
    "bull",
    "adoption",
    "approve",
    "etf",
  ];
  const negativeWords = [
    "fall",
    "decrease",
    "below",
    "lower",
    "bear",
    "ban",
    "crash",
    "reject",
  ];

  const positiveCount = positiveWords.filter((w) => text.includes(w)).length;
  const negativeCount = negativeWords.filter((w) => text.includes(w)).length;

  if (positiveCount > negativeCount) return "positive";
  if (negativeCount > positiveCount) return "negative";
  return "mixed";
}

function analyzeSmartMoney(holders: Array<{ amount: number }>): {
  sentiment: "bullish" | "bearish" | "neutral";
  topHoldersConcentration: number;
} | null {
  if (holders.length === 0) return null;

  const totalAmount = holders.reduce((sum, h) => sum + h.amount, 0);
  const topHoldersConcentration =
    totalAmount > 0
      ? (holders.slice(0, 10).reduce((sum, h) => sum + h.amount, 0) /
          totalAmount) *
        100
      : 0;

  // Простая эвристика: высокая концентрация = уверенность
  let sentiment: "bullish" | "bearish" | "neutral" = "neutral";
  if (topHoldersConcentration > 50) {
    sentiment = "bullish"; // Высокая концентрация часто указывает на убежденность
  }

  return { sentiment, topHoldersConcentration };
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toFixed(0);
}
