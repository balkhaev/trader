import {
  type CreateMarketData,
  type NewsArticle,
  newsRepository,
  predictionMarketRepository,
} from "@trader/db";
import type { ResolutionCriteria } from "@trader/db/schema/prediction-market";
import { logger } from "../../lib/logger";
import { openaiService } from "../llm/openai.service";

type MarketCategory =
  | "macro"
  | "crypto"
  | "corporate"
  | "geo"
  | "commodity"
  | "other";

interface GeneratedMarket {
  question: string;
  description: string;
  category: MarketCategory;
  resolutionCriteria: ResolutionCriteria;
  resolvesAt: string;
  relatedSymbols: string[];
  tags: string[];
  confidence: number;
}

interface GeneratorOptions {
  minConfidence?: number;
  maxMarketsPerArticle?: number;
  categories?: MarketCategory[];
}

const MARKET_GENERATION_PROMPT = `You are an expert at creating prediction markets from news articles.

Given a news article, generate prediction markets that:
1. Are clear, specific, and resolvable with objective criteria
2. Have a clear resolution date (usually 1-7 days, max 30 days)
3. Are relevant to traders and investors
4. Have binary outcomes (YES/NO)

For each market, provide:
- question: A clear yes/no question (e.g., "Will BTC reach $100K by January 15?")
- description: Brief context from the article
- category: One of "crypto", "macro", "corporate", "geo", "commodity", "other"
- resolutionCriteria: How to objectively resolve this market
- resolvesAt: ISO date string when this should resolve
- relatedSymbols: Relevant trading symbols (e.g., ["BTCUSDT", "ETH"])
- tags: Topic tags (e.g., ["bitcoin", "price-prediction"])
- confidence: Your confidence 0-1 that this is a good market

Focus on:
- Price movements and targets
- Product launches and announcements
- Regulatory decisions
- Major events and deadlines
- Partnerships and deals

Avoid:
- Subjective or opinion-based questions
- Markets that can't be clearly resolved
- Questions with indefinite timelines
- Markets about trivial or non-tradeable events

Return a JSON array of markets. If no good markets can be generated, return an empty array.`;

class MarketGeneratorService {
  private log = logger.child("generator");

  /**
   * Generate prediction markets from a single article
   */
  async generateFromArticle(
    articleId: string,
    options: GeneratorOptions = {}
  ): Promise<CreateMarketData[]> {
    const { minConfidence = 0.6, maxMarketsPerArticle = 3 } = options;

    // Get article
    const article = await newsRepository.findArticleById(articleId);
    if (!article) {
      this.log.warn("Article not found", { articleId });
      return [];
    }

    // Generate markets using LLM
    const generatedMarkets = await this.callLLM(article, maxMarketsPerArticle);

    // Filter by confidence
    const filteredMarkets = generatedMarkets.filter(
      (m) => m.confidence >= minConfidence
    );

    // Convert to CreateMarketData
    const markets: CreateMarketData[] = filteredMarkets.map((m) => ({
      question: m.question,
      description: m.description,
      category: m.category,
      resolutionCriteria: m.resolutionCriteria,
      resolvesAt: new Date(m.resolvesAt),
      sourceArticleId: articleId,
      creationType: "ai" as const,
      relatedSymbols: m.relatedSymbols,
      tags: m.tags,
      metadata: {
        aiConfidence: m.confidence,
        originalHeadline: article.title,
      },
    }));

    this.log.info("Markets generated from article", {
      articleId,
      generated: generatedMarkets.length,
      filtered: markets.length,
    });

    return markets;
  }

  /**
   * Generate and save markets from an article
   */
  async generateAndSave(
    articleId: string,
    options: GeneratorOptions = {}
  ): Promise<{ created: number; marketIds: string[] }> {
    const markets = await this.generateFromArticle(articleId, options);

    const marketIds: string[] = [];

    for (const marketData of markets) {
      try {
        const market = await predictionMarketRepository.create(marketData);
        marketIds.push(market.id);
        this.log.info("Market created", {
          id: market.id,
          question: market.question.slice(0, 50),
        });
      } catch (error) {
        this.log.error("Failed to create market", {
          error: error instanceof Error ? error.message : String(error),
          question: marketData.question.slice(0, 50),
        });
      }
    }

    return {
      created: marketIds.length,
      marketIds,
    };
  }

  /**
   * Process unprocessed articles and generate markets
   */
  async processRecentArticles(
    hoursBack = 24,
    options: GeneratorOptions = {}
  ): Promise<{ processed: number; created: number }> {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get recent articles
    const { data: articles } = await newsRepository.findArticles({
      limit: 50,
    });

    // Filter to recent articles
    const recentArticles = articles.filter(
      (a: NewsArticle) => a.publishedAt && new Date(a.publishedAt) >= since
    );

    let totalCreated = 0;

    for (const article of recentArticles) {
      // TODO: Check if we already have markets from this article
      // For now, generate for all

      const { created } = await this.generateAndSave(article.id, options);
      totalCreated += created;

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    this.log.info("Processed recent articles", {
      processed: recentArticles.length,
      created: totalCreated,
    });

    return {
      processed: recentArticles.length,
      created: totalCreated,
    };
  }

  /**
   * Call LLM to generate markets
   */
  private async callLLM(
    article: NewsArticle,
    maxMarkets: number
  ): Promise<GeneratedMarket[]> {
    const articleContent = `
Title: ${article.title}
Source: ${article.sourceId}
Published: ${article.publishedAt?.toISOString() ?? "unknown"}
Category: ${article.category ?? "general"}

Summary: ${article.summary ?? "No summary available"}

Content: ${(article.content ?? article.summary ?? "").slice(0, 2000)}
    `.trim();

    try {
      const response = await openaiService.chat({
        messages: [
          {
            role: "system",
            content: MARKET_GENERATION_PROMPT,
          },
          {
            role: "user",
            content: `Generate up to ${maxMarkets} prediction markets from this article:\n\n${articleContent}`,
          },
        ],
        responseFormat: { type: "json_object" },
        temperature: 0.7,
      });

      const parsed = JSON.parse(response.content ?? "{}");
      const markets: GeneratedMarket[] = parsed.markets ?? [];

      // Validate and sanitize
      return markets.filter((m) => this.isValidMarket(m)).slice(0, maxMarkets);
    } catch (error) {
      this.log.error("LLM generation failed", {
        error: error instanceof Error ? error.message : String(error),
        articleId: article.id,
      });
      return [];
    }
  }

  /**
   * Validate generated market structure
   */
  private isValidMarket(m: Partial<GeneratedMarket>): m is GeneratedMarket {
    return (
      typeof m.question === "string" &&
      m.question.length > 10 &&
      m.question.endsWith("?") &&
      typeof m.category === "string" &&
      ["crypto", "macro", "corporate", "geo", "commodity", "other"].includes(
        m.category
      ) &&
      typeof m.resolvesAt === "string" &&
      !Number.isNaN(Date.parse(m.resolvesAt)) &&
      typeof m.confidence === "number" &&
      m.confidence >= 0 &&
      m.confidence <= 1 &&
      typeof m.resolutionCriteria === "object" &&
      m.resolutionCriteria !== null
    );
  }
}

export const marketGeneratorService = new MarketGeneratorService();
