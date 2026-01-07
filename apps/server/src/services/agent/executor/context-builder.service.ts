import { type AgentStrategy, db, newsAnalysis, newsRepository } from "@trader/db";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import type {
  AffectedAsset,
  NewsContext,
  NewsRecommendation,
  SentimentPeriod,
  SentimentTrend,
} from "./types";

/**
 * Aggregated news analysis data for agent context
 */
export interface AggregatedNewsAnalysis {
  /** Combined key points from all analyses */
  keyPoints: string[];
  /** Trading recommendations from analyses */
  recommendations: NewsRecommendation[];
  /** Assets affected by the news */
  affectedAssets: AffectedAsset[];
  /** Average impact score (0 to 1) */
  avgImpactScore: number;
  /** Average sentiment score (-1 to 1) */
  avgSentimentScore: number;
  /** Number of analyses aggregated */
  analysisCount: number;
}

class ContextBuilderService {
  private log = logger.child("context-builder");

  /**
   * Aggregate analysis data from newsAnalysis table for given article IDs.
   * Only includes completed analyses.
   *
   * @param articleIds - Array of article IDs to fetch analyses for
   * @returns Aggregated analysis data or null if no analyses found
   */
  async getNewsAnalysisData(
    articleIds: string[]
  ): Promise<AggregatedNewsAnalysis | null> {
    if (articleIds.length === 0) {
      return null;
    }

    try {
      // Query completed analyses for the given article IDs
      const analyses = await db
        .select()
        .from(newsAnalysis)
        .where(
          and(
            inArray(newsAnalysis.articleId, articleIds),
            eq(newsAnalysis.status, "completed")
          )
        );

      if (analyses.length === 0) {
        this.log.debug("No completed analyses found for articles", {
          articleCount: articleIds.length,
        });
        return null;
      }

      // Aggregate key points (deduplicated)
      const keyPointsSet = new Set<string>();
      for (const analysis of analyses) {
        const points = analysis.keyPoints ?? [];
        for (const point of points) {
          keyPointsSet.add(point);
        }
      }

      // Aggregate recommendations
      const recommendations: NewsRecommendation[] = [];
      for (const analysis of analyses) {
        const rec = analysis.recommendation;
        if (rec) {
          recommendations.push({
            action: rec.action,
            symbols: rec.symbols,
            reasoning: rec.reasoning,
          });
        }
      }

      // Aggregate affected assets (merge by symbol, use highest confidence)
      const assetMap = new Map<string, AffectedAsset>();
      for (const analysis of analyses) {
        const assets = analysis.affectedAssets ?? [];
        for (const asset of assets) {
          const existing = assetMap.get(asset.symbol);
          if (!existing || asset.confidence > existing.confidence) {
            assetMap.set(asset.symbol, {
              symbol: asset.symbol,
              impact: asset.impact,
              confidence: asset.confidence,
            });
          }
        }
      }

      // Calculate average impact score
      const impactScores = analyses
        .filter((a) => a.impactScore !== null)
        .map((a) => Number(a.impactScore));
      const avgImpactScore =
        impactScores.length > 0
          ? impactScores.reduce((sum, s) => sum + s, 0) / impactScores.length
          : 0;

      // Calculate average sentiment score
      const sentimentScores = analyses
        .filter((a) => a.sentimentScore !== null)
        .map((a) => Number(a.sentimentScore));
      const avgSentimentScore =
        sentimentScores.length > 0
          ? sentimentScores.reduce((sum, s) => sum + s, 0) /
            sentimentScores.length
          : 0;

      const result: AggregatedNewsAnalysis = {
        keyPoints: Array.from(keyPointsSet),
        recommendations,
        affectedAssets: Array.from(assetMap.values()),
        avgImpactScore,
        avgSentimentScore,
        analysisCount: analyses.length,
      };

      this.log.debug("News analysis data aggregated", {
        articleCount: articleIds.length,
        analysisCount: analyses.length,
        keyPointCount: result.keyPoints.length,
        recommendationCount: result.recommendations.length,
        affectedAssetCount: result.affectedAssets.length,
        avgImpactScore: avgImpactScore.toFixed(2),
      });

      return result;
    } catch (error) {
      this.log.error("Failed to aggregate news analysis data", {
        error: error instanceof Error ? error.message : String(error),
        articleCount: articleIds.length,
      });
      return null;
    }
  }

  /**
   * Calculate sentiment trend by comparing current period vs previous period.
   * Uses analyzedAt timestamp to determine period boundaries.
   *
   * @param period - Time period to analyze ('1h' or '24h')
   * @returns SentimentTrend with direction, change, and period or null if insufficient data
   */
  async calculateSentimentTrend(
    period: SentimentPeriod
  ): Promise<SentimentTrend | null> {
    const now = new Date();
    const periodMs = period === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    // Current period: from (now - periodMs) to now
    const currentPeriodStart = new Date(now.getTime() - periodMs);
    // Previous period: from (now - 2*periodMs) to (now - periodMs)
    const previousPeriodStart = new Date(now.getTime() - 2 * periodMs);

    try {
      // Query sentiment scores for current period
      const currentPeriodAnalyses = await db
        .select({ sentimentScore: newsAnalysis.sentimentScore })
        .from(newsAnalysis)
        .where(
          and(
            eq(newsAnalysis.status, "completed"),
            gte(newsAnalysis.analyzedAt, currentPeriodStart),
            lt(newsAnalysis.analyzedAt, now)
          )
        );

      // Query sentiment scores for previous period
      const previousPeriodAnalyses = await db
        .select({ sentimentScore: newsAnalysis.sentimentScore })
        .from(newsAnalysis)
        .where(
          and(
            eq(newsAnalysis.status, "completed"),
            gte(newsAnalysis.analyzedAt, previousPeriodStart),
            lt(newsAnalysis.analyzedAt, currentPeriodStart)
          )
        );

      // Calculate average sentiment for current period
      const currentScores = currentPeriodAnalyses
        .filter((a) => a.sentimentScore !== null)
        .map((a) => Number(a.sentimentScore));
      const currentAvg =
        currentScores.length > 0
          ? currentScores.reduce((sum, s) => sum + s, 0) / currentScores.length
          : 0;

      // Calculate average sentiment for previous period
      const previousScores = previousPeriodAnalyses
        .filter((a) => a.sentimentScore !== null)
        .map((a) => Number(a.sentimentScore));
      const previousAvg =
        previousScores.length > 0
          ? previousScores.reduce((sum, s) => sum + s, 0) / previousScores.length
          : 0;

      // Calculate change (clamped to -1 to 1 range)
      const change = Math.max(-1, Math.min(1, currentAvg - previousAvg));

      // Determine direction based on change magnitude
      // Use threshold to avoid classifying noise as a trend
      const TREND_THRESHOLD = 0.05;
      let direction: SentimentTrend["direction"];
      if (change > TREND_THRESHOLD) {
        direction = "improving";
      } else if (change < -TREND_THRESHOLD) {
        direction = "declining";
      } else {
        direction = "stable";
      }

      const result: SentimentTrend = {
        direction,
        change: Number(change.toFixed(4)),
        period,
      };

      this.log.debug("Sentiment trend calculated", {
        period,
        currentPeriodCount: currentScores.length,
        previousPeriodCount: previousScores.length,
        currentAvg: currentAvg.toFixed(4),
        previousAvg: previousAvg.toFixed(4),
        change: change.toFixed(4),
        direction,
      });

      return result;
    } catch (error) {
      this.log.error("Failed to calculate sentiment trend", {
        error: error instanceof Error ? error.message : String(error),
        period,
      });
      return null;
    }
  }

  /**
   * Build enriched news context for agent decision making.
   * Fetches recent articles, aggregates analysis data, and calculates sentiment trend.
   *
   * @param strategy - Agent strategy to check if news data source is enabled
   * @returns Enriched NewsContext or undefined if news is not a data source
   */
  async getNewsContext(
    strategy: AgentStrategy
  ): Promise<NewsContext | undefined> {
    // Check if news data source is enabled in strategy
    if (!strategy.dataSources.includes("news")) {
      return undefined;
    }

    try {
      // Fetch recent articles (last 24 hours, limit to 10 for context)
      const { data: recentArticles } = await newsRepository.findArticles({
        hoursAgo: 24,
        limit: 10,
      });

      // Extract headlines from articles
      const headlines = recentArticles.map((article) => article.title);

      // If no articles found, return minimal context with neutral sentiment
      if (recentArticles.length === 0) {
        this.log.debug("No recent news articles found, returning empty context");
        return {
          headlines: [],
          sentiment: 0,
        };
      }

      // Get article IDs for analysis aggregation
      const articleIds = recentArticles.map((article) => article.id);

      // Fetch aggregated analysis data and sentiment trend in parallel
      const [analysisData, sentimentTrend] = await Promise.all([
        this.getNewsAnalysisData(articleIds),
        this.calculateSentimentTrend("1h"),
      ]);

      // Build enriched NewsContext
      const newsContext: NewsContext = {
        headlines,
        sentiment: analysisData?.avgSentimentScore ?? 0,
      };

      // Add enriched fields if analysis data is available
      if (analysisData) {
        if (analysisData.keyPoints.length > 0) {
          newsContext.keyPoints = analysisData.keyPoints;
        }
        if (analysisData.recommendations.length > 0) {
          newsContext.recommendations = analysisData.recommendations;
        }
        if (analysisData.affectedAssets.length > 0) {
          newsContext.affectedAssets = analysisData.affectedAssets;
        }
      }

      // Add sentiment trend if calculated
      if (sentimentTrend) {
        newsContext.sentimentTrend = sentimentTrend;
      }

      this.log.debug("News context built", {
        headlineCount: headlines.length,
        hasAnalysis: analysisData !== null,
        hasTrend: sentimentTrend !== null,
        sentiment: newsContext.sentiment.toFixed(2),
        keyPointCount: newsContext.keyPoints?.length ?? 0,
        recommendationCount: newsContext.recommendations?.length ?? 0,
        affectedAssetCount: newsContext.affectedAssets?.length ?? 0,
      });

      return newsContext;
    } catch (error) {
      this.log.error("Failed to build news context", {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return minimal context on error rather than undefined
      // This ensures agent can still operate with basic fallback
      return {
        headlines: [],
        sentiment: 0,
      };
    }
  }
}

export const contextBuilderService = new ContextBuilderService();
