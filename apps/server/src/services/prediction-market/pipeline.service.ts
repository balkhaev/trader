/**
 * News → Market Pipeline Service
 *
 * Automatically generates prediction markets from high-impact news articles.
 * Features:
 * - Hooks into news ingestion
 * - Deduplication (one market per article)
 * - Rate limiting (max N markets per day)
 * - Impact-based filtering
 */

import {
  db,
  newsAnalysis,
  newsRepository,
  predictionMarket,
  predictionMarketRepository,
} from "@trader/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { Logger } from "../../lib/logger";
import { newsEventEmitter } from "../news/realtime/event-emitter";
import { marketGeneratorService } from "./generator.service";

interface PipelineConfig {
  /** Minimum impact score to generate market (0-1) */
  minImpactScore: number;
  /** Maximum markets to create per day */
  maxMarketsPerDay: number;
  /** Initial liquidity for auto-generated markets */
  initialLiquidity: number;
  /** Categories to process */
  allowedCategories: string[];
  /** Delay between market generations (ms) */
  generationDelay: number;
}

interface PipelineStats {
  marketsCreatedToday: number;
  articlesProcessed: number;
  articlesSkipped: number;
  lastProcessedAt: Date | null;
}

const DEFAULT_CONFIG: PipelineConfig = {
  minImpactScore: 0.7,
  maxMarketsPerDay: 10,
  initialLiquidity: 1000,
  allowedCategories: ["crypto", "stocks", "macro", "regulation"],
  generationDelay: 5000,
};

class MarketPipelineService {
  private log = new Logger("MarketPipeline");
  private config: PipelineConfig = DEFAULT_CONFIG;
  private stats: PipelineStats = {
    marketsCreatedToday: 0,
    articlesProcessed: 0,
    articlesSkipped: 0,
    lastProcessedAt: null,
  };
  private isRunning = false;
  private processingQueue: string[] = [];
  private isProcessing = false;

  /**
   * Start the pipeline - listen for new articles
   */
  start(customConfig?: Partial<PipelineConfig>): void {
    if (this.isRunning) {
      this.log.warn("Pipeline already running");
      return;
    }

    if (customConfig) {
      this.config = { ...this.config, ...customConfig };
    }

    this.log.info("Starting market pipeline", { config: this.config });

    // Subscribe to article saved events
    newsEventEmitter.onArticleSaved((article) => {
      this.queueArticle(article.id);
    });

    this.isRunning = true;
    this.resetDailyStats();

    // Reset stats at midnight
    this.scheduleDailyReset();

    this.log.info("Market pipeline started");
  }

  /**
   * Stop the pipeline
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    this.processingQueue = [];
    this.log.info("Market pipeline stopped");
  }

  /**
   * Manually trigger processing for an article
   */
  async processArticle(articleId: string): Promise<{
    processed: boolean;
    reason?: string;
    marketId?: string;
  }> {
    // Check rate limit
    if (await this.isRateLimited()) {
      return {
        processed: false,
        reason: "Rate limit reached for today",
      };
    }

    // Check if market already exists for this article
    if (await this.hasExistingMarket(articleId)) {
      return {
        processed: false,
        reason: "Market already exists for this article",
      };
    }

    // Get article with analysis
    const article = await newsRepository.findArticleById(articleId);
    if (!article) {
      return {
        processed: false,
        reason: "Article not found",
      };
    }

    // Check category
    if (
      article.category &&
      !this.config.allowedCategories.includes(article.category)
    ) {
      return {
        processed: false,
        reason: `Category ${article.category} not allowed`,
      };
    }

    // Check impact score from analysis
    const analysis = await this.getArticleAnalysis(articleId);
    if (analysis) {
      const impactScore = Number(analysis.impactScore ?? 0);
      if (impactScore < this.config.minImpactScore) {
        return {
          processed: false,
          reason: `Impact score ${impactScore} below threshold ${this.config.minImpactScore}`,
        };
      }
    }

    // Generate market
    try {
      const result = await marketGeneratorService.generateAndSave(articleId, {
        maxMarkets: 1,
        initialLiquidity: this.config.initialLiquidity,
      });

      if (result.created > 0) {
        this.stats.marketsCreatedToday++;
        this.stats.articlesProcessed++;
        this.stats.lastProcessedAt = new Date();

        this.log.info("Market created from article", {
          articleId,
          marketIds: result.marketIds,
        });

        return {
          processed: true,
          marketId: result.marketIds[0],
        };
      }

      return {
        processed: false,
        reason: "Generator did not create any markets",
      };
    } catch (error) {
      this.log.error("Failed to generate market", {
        articleId,
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        processed: false,
        reason: error instanceof Error ? error.message : "Generation failed",
      };
    }
  }

  /**
   * Process articles in batch (for backfill)
   */
  async processBatch(params: {
    hoursBack?: number;
    limit?: number;
    dryRun?: boolean;
  }): Promise<{
    processed: number;
    skipped: number;
    created: number;
    results: Array<{ articleId: string; result: string }>;
  }> {
    const hoursBack = params.hoursBack ?? 24;
    const limit = params.limit ?? 50;

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    // Get analyzed articles with high impact
    const articles = await db
      .select({
        articleId: newsAnalysis.articleId,
        impactScore: newsAnalysis.impactScore,
      })
      .from(newsAnalysis)
      .where(
        and(
          eq(newsAnalysis.status, "completed"),
          gte(newsAnalysis.analyzedAt, since),
          sql`CAST(${newsAnalysis.impactScore} AS DECIMAL) >= ${this.config.minImpactScore}`
        )
      )
      .limit(limit);

    const results: Array<{ articleId: string; result: string }> = [];
    let processed = 0;
    let skipped = 0;
    let created = 0;

    for (const { articleId } of articles) {
      if (!articleId) continue;

      if (params.dryRun) {
        results.push({ articleId, result: "Would process (dry run)" });
        processed++;
        continue;
      }

      const result = await this.processArticle(articleId);

      if (result.processed) {
        created++;
        processed++;
        results.push({
          articleId,
          result: `Created market ${result.marketId}`,
        });
      } else {
        skipped++;
        results.push({
          articleId,
          result: result.reason ?? "Skipped",
        });
      }

      // Delay between generations
      await new Promise((r) => setTimeout(r, this.config.generationDelay));
    }

    this.log.info("Batch processing complete", { processed, skipped, created });

    return { processed, skipped, created, results };
  }

  /**
   * Get pipeline status
   */
  getStatus(): {
    isRunning: boolean;
    config: PipelineConfig;
    stats: PipelineStats;
    queueLength: number;
  } {
    return {
      isRunning: this.isRunning,
      config: this.config,
      stats: this.stats,
      queueLength: this.processingQueue.length,
    };
  }

  /**
   * Update pipeline config
   */
  updateConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    this.log.info("Config updated", { config: this.config });
  }

  // Private methods

  private queueArticle(articleId: string): void {
    if (!this.isRunning) return;

    this.processingQueue.push(articleId);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const articleId = this.processingQueue.shift();
      if (!articleId) continue;

      // Wait for analysis to complete (give it some time)
      await new Promise((r) => setTimeout(r, 10_000));

      await this.processArticle(articleId);
      await new Promise((r) => setTimeout(r, this.config.generationDelay));
    }

    this.isProcessing = false;
  }

  private async isRateLimited(): Promise<boolean> {
    // Count markets created today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [result] = await db
      .select({ count: sql<number>`count(*)` })
      .from(predictionMarket)
      .where(gte(predictionMarket.createdAt, today));

    const todayCount = result?.count ?? 0;

    return todayCount >= this.config.maxMarketsPerDay;
  }

  private async hasExistingMarket(articleId: string): Promise<boolean> {
    const existing =
      await predictionMarketRepository.findBySourceArticle(articleId);
    return existing !== null;
  }

  private async getArticleAnalysis(articleId: string) {
    const [analysis] = await db
      .select()
      .from(newsAnalysis)
      .where(
        and(
          eq(newsAnalysis.articleId, articleId),
          eq(newsAnalysis.status, "completed")
        )
      );
    return analysis;
  }

  private resetDailyStats(): void {
    this.stats = {
      marketsCreatedToday: 0,
      articlesProcessed: 0,
      articlesSkipped: 0,
      lastProcessedAt: null,
    };
  }

  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      this.resetDailyStats();
      this.scheduleDailyReset();
    }, msUntilMidnight);
  }
}

export const marketPipelineService = new MarketPipelineService();
