import type { InferSelectModel } from "drizzle-orm";
import { and, count, desc, eq, gte, type SQL } from "drizzle-orm";
import { newsAnalysis, newsArticle, newsSource } from "../schema/news";
import {
  BaseRepository,
  type PaginatedResult,
  type PaginationParams,
} from "./base.repository";

// Types
export type NewsArticle = InferSelectModel<typeof newsArticle>;
export type NewsSource = InferSelectModel<typeof newsSource>;
export type NewsAnalysis = InferSelectModel<typeof newsAnalysis>;

export interface ArticleFilters extends PaginationParams {
  sourceId?: string;
  category?: string;
  symbols?: string[];
  hoursAgo?: number;
}

export interface SourceFilters extends PaginationParams {
  userId?: string;
  type?: string;
  enabled?: boolean;
}

export interface ArticleStats {
  totalArticles: number;
  articlesLast24h: number;
  activeSources: number;
  articlesByCategory: Record<string, number>;
}

class NewsRepository extends BaseRepository<typeof newsArticle> {
  constructor() {
    super(newsArticle);
  }

  // ===== Articles =====

  async findArticles(
    filters: ArticleFilters
  ): Promise<PaginatedResult<NewsArticle>> {
    const {
      sourceId,
      category,
      symbols,
      hoursAgo,
      limit = 50,
      offset = 0,
    } = filters;

    const conditions: SQL[] = [];

    if (sourceId) conditions.push(eq(newsArticle.sourceId, sourceId));
    if (category) {
      const validCategory = category as NonNullable<NewsArticle["category"]>;
      conditions.push(eq(newsArticle.category, validCategory));
    }
    if (hoursAgo) {
      const since = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
      conditions.push(gte(newsArticle.publishedAt, since));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const query = this.db
      .select()
      .from(newsArticle)
      .where(whereClause)
      .orderBy(desc(newsArticle.publishedAt))
      .limit(limit)
      .offset(offset);

    const [data, countResult] = await Promise.all([
      query,
      this.db.select({ count: count() }).from(newsArticle).where(whereClause),
    ]);

    // Filter by symbols in application if needed
    let filteredData = data;
    if (symbols?.length) {
      filteredData = data.filter((article) => {
        const articleSymbols = article.symbols ?? [];
        return symbols.some((s) => articleSymbols.includes(s));
      });
    }

    const total = Number(countResult[0]?.count ?? 0);

    return {
      data: filteredData,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  async findArticleById(articleId: string): Promise<NewsArticle | null> {
    const [article] = await this.db
      .select()
      .from(newsArticle)
      .where(eq(newsArticle.id, articleId));

    return article ?? null;
  }

  async findArticleWithAnalysis(articleId: string): Promise<{
    article: NewsArticle;
    analysis: NewsAnalysis | null;
  } | null> {
    const article = await this.findArticleById(articleId);
    if (!article) return null;

    const [analysis] = await this.db
      .select()
      .from(newsAnalysis)
      .where(eq(newsAnalysis.articleId, articleId))
      .orderBy(desc(newsAnalysis.createdAt))
      .limit(1);

    return {
      article,
      analysis: analysis ?? null,
    };
  }

  // ===== Sources =====

  async findSources(
    filters: SourceFilters
  ): Promise<PaginatedResult<NewsSource>> {
    const { userId, type, enabled, limit = 50, offset = 0 } = filters;

    const conditions: SQL[] = [];

    if (userId) conditions.push(eq(newsSource.userId, userId));
    if (type) conditions.push(eq(newsSource.type, type as NewsSource["type"]));
    if (enabled !== undefined) conditions.push(eq(newsSource.enabled, enabled));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(newsSource)
        .where(whereClause)
        .orderBy(desc(newsSource.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ count: count() }).from(newsSource).where(whereClause),
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

  async findSourceById(sourceId: string): Promise<NewsSource | null> {
    const [source] = await this.db
      .select()
      .from(newsSource)
      .where(eq(newsSource.id, sourceId));

    return source ?? null;
  }

  async findEnabledSources(): Promise<NewsSource[]> {
    return this.db
      .select()
      .from(newsSource)
      .where(eq(newsSource.enabled, true));
  }

  // ===== Stats =====

  async getStats(): Promise<ArticleStats> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [totalResult, last24hResult, activeSourcesResult, byCategoryResult] =
      await Promise.all([
        this.db.select({ count: count() }).from(newsArticle),
        this.db
          .select({ count: count() })
          .from(newsArticle)
          .where(gte(newsArticle.publishedAt, last24h)),
        this.db
          .select({ count: count() })
          .from(newsSource)
          .where(eq(newsSource.enabled, true)),
        this.db
          .select({
            category: newsArticle.category,
            count: count(),
          })
          .from(newsArticle)
          .where(gte(newsArticle.publishedAt, last24h))
          .groupBy(newsArticle.category),
      ]);

    const articlesByCategory = Object.fromEntries(
      byCategoryResult.map((r) => [r.category ?? "other", Number(r.count)])
    );

    return {
      totalArticles: Number(totalResult[0]?.count ?? 0),
      articlesLast24h: Number(last24hResult[0]?.count ?? 0),
      activeSources: Number(activeSourcesResult[0]?.count ?? 0),
      articlesByCategory,
    };
  }

  // ===== Create / Update =====

  async createArticle(
    data: Omit<NewsArticle, "id" | "fetchedAt">
  ): Promise<NewsArticle> {
    const [article] = await this.db
      .insert(newsArticle)
      .values(data)
      .onConflictDoNothing()
      .returning();

    return article!;
  }

  async updateSourceLastFetched(sourceId: string): Promise<void> {
    await this.db
      .update(newsSource)
      .set({ lastFetchedAt: new Date() })
      .where(eq(newsSource.id, sourceId));
  }
}

export const newsRepository = new NewsRepository();
