import { db, newsAnalysis } from "@trader/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import type { AffectedAsset, NewsRecommendation } from "./types";

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
}

export const contextBuilderService = new ContextBuilderService();
