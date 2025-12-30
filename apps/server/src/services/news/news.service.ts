import { db, newsAnalysis, newsArticle, newsSource } from "@trader/db";
import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { RssParser } from "./parsers/rss.parser";
import { getAllPresets } from "./sources-config";
import type { FetchProgress, NewsParser } from "./types";

type NewsSource = InferSelectModel<typeof newsSource>;
type NewsArticle = InferSelectModel<typeof newsArticle>;

const parsers: Record<string, NewsParser> = {
  rss: new RssParser(),
};

// Прогресс синхронизации в памяти
const fetchProgress = new Map<string, FetchProgress>();

export const newsService = {
  // Управление источниками
  async getSources(userId?: string) {
    const conditions = userId ? eq(newsSource.userId, userId) : undefined;
    return db.select().from(newsSource).where(conditions);
  },

  async getSource(sourceId: string) {
    const [source] = await db
      .select()
      .from(newsSource)
      .where(eq(newsSource.id, sourceId));
    return source;
  },

  async createSource(data: {
    userId?: string;
    name: string;
    type: "rss" | "api" | "twitter" | "telegram" | "web_scraper";
    url: string;
    apiKey?: string;
    category?:
      | "crypto"
      | "stocks"
      | "forex"
      | "commodities"
      | "macro"
      | "regulation"
      | "technology"
      | "other";
    fetchInterval?: number;
    config?: NewsSource["config"];
  }) {
    const [source] = await db
      .insert(newsSource)
      .values({
        userId: data.userId,
        name: data.name,
        type: data.type,
        url: data.url,
        apiKey: data.apiKey,
        category: data.category || "crypto",
        fetchInterval: data.fetchInterval?.toString() || "300",
        config: data.config,
      })
      .returning();
    return source;
  },

  async updateSource(
    sourceId: string,
    data: Partial<{
      name: string;
      url: string;
      apiKey: string;
      enabled: boolean;
      fetchInterval: number;
      config: NewsSource["config"];
    }>
  ) {
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.url !== undefined) updateData.url = data.url;
    if (data.apiKey !== undefined) updateData.apiKey = data.apiKey;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.fetchInterval !== undefined)
      updateData.fetchInterval = data.fetchInterval.toString();
    if (data.config !== undefined) updateData.config = data.config;

    const [updated] = await db
      .update(newsSource)
      .set(updateData)
      .where(eq(newsSource.id, sourceId))
      .returning();
    return updated;
  },

  async deleteSource(sourceId: string) {
    await db.delete(newsSource).where(eq(newsSource.id, sourceId));
  },

  // Фетч новостей
  async fetchSource(sourceId: string): Promise<FetchProgress> {
    const progress: FetchProgress = {
      sourceId,
      status: "running",
      articlesFound: 0,
      articlesSaved: 0,
      startedAt: new Date(),
    };
    fetchProgress.set(sourceId, progress);

    try {
      const [source] = await db
        .select()
        .from(newsSource)
        .where(eq(newsSource.id, sourceId));

      if (!(source && source.enabled)) {
        throw new Error("Source not found or disabled");
      }

      const parser = parsers[source.type];
      if (!parser) {
        throw new Error(`No parser for source type: ${source.type}`);
      }

      const articles = await parser.parse({
        id: source.id,
        url: source.url,
        apiKey: source.apiKey || undefined,
        config: source.config || undefined,
      });

      progress.articlesFound = articles.length;

      for (const article of articles) {
        try {
          await db
            .insert(newsArticle)
            .values({
              sourceId: source.id,
              externalId: article.externalId,
              url: article.url,
              title: article.title,
              content: article.content,
              summary: article.summary,
              author: article.author,
              imageUrl: article.imageUrl,
              category: source.category,
              tags: article.tags,
              symbols: article.symbols,
              publishedAt: article.publishedAt,
              metadata: article.metadata,
            })
            .onConflictDoNothing();
          progress.articlesSaved++;
        } catch {
          // Пропускаем дубликаты
        }
      }

      // Обновляем lastFetchedAt
      await db
        .update(newsSource)
        .set({ lastFetchedAt: new Date() })
        .where(eq(newsSource.id, sourceId));

      progress.status = "completed";
      progress.completedAt = new Date();
    } catch (error) {
      progress.status = "failed";
      progress.error = error instanceof Error ? error.message : "Unknown error";
      progress.completedAt = new Date();
    }

    fetchProgress.set(sourceId, progress);
    return progress;
  },

  async fetchAllSources(): Promise<FetchProgress[]> {
    const sources = await db
      .select()
      .from(newsSource)
      .where(eq(newsSource.enabled, true));

    const results: FetchProgress[] = [];

    for (const source of sources) {
      const result = await this.fetchSource(source.id);
      results.push(result);
      // Rate limiting
      await new Promise((r) => setTimeout(r, 1000));
    }

    return results;
  },

  getFetchProgress(sourceId: string): FetchProgress | undefined {
    return fetchProgress.get(sourceId);
  },

  // Получение статей
  async getArticles(params: {
    limit?: number;
    offset?: number;
    category?: string;
    symbols?: string[];
    hoursAgo?: number;
    sourceId?: string;
  }): Promise<NewsArticle[]> {
    const conditions = [];

    if (params.category) {
      conditions.push(
        eq(
          newsArticle.category,
          params.category as NonNullable<NewsArticle["category"]>
        )
      );
    }

    if (params.sourceId) {
      conditions.push(eq(newsArticle.sourceId, params.sourceId));
    }

    if (params.hoursAgo) {
      const since = new Date(Date.now() - params.hoursAgo * 60 * 60 * 1000);
      conditions.push(gte(newsArticle.publishedAt, since));
    }

    if (params.symbols?.length) {
      conditions.push(
        sql`${newsArticle.symbols}::jsonb ?| array[${sql.raw(
          params.symbols.map((s) => `'${s}'`).join(",")
        )}]`
      );
    }

    return db
      .select()
      .from(newsArticle)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(newsArticle.publishedAt))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);
  },

  async getArticle(articleId: string) {
    const [article] = await db
      .select()
      .from(newsArticle)
      .where(eq(newsArticle.id, articleId));
    return article;
  },

  async getArticleWithAnalysis(articleId: string) {
    const [article] = await db
      .select()
      .from(newsArticle)
      .where(eq(newsArticle.id, articleId));

    if (!article) return null;

    const analyses = await db
      .select()
      .from(newsAnalysis)
      .where(eq(newsAnalysis.articleId, articleId))
      .orderBy(desc(newsAnalysis.createdAt));

    return { ...article, analyses };
  },

  async getUnanalyzedArticles(limit = 10) {
    return db
      .select({
        article: newsArticle,
      })
      .from(newsArticle)
      .leftJoin(newsAnalysis, eq(newsArticle.id, newsAnalysis.articleId))
      .where(isNull(newsAnalysis.id))
      .orderBy(desc(newsArticle.publishedAt))
      .limit(limit);
  },

  // Статистика
  async getStats() {
    const [sourcesCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsSource);

    const [articlesCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsArticle);

    const [analysesCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsAnalysis)
      .where(eq(newsAnalysis.status, "completed"));

    const [last24h] = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsArticle)
      .where(
        gte(newsArticle.publishedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      );

    return {
      totalSources: sourcesCount?.count || 0,
      totalArticles: articlesCount?.count || 0,
      totalAnalyses: analysesCount?.count || 0,
      articlesLast24h: last24h?.count || 0,
    };
  },

  // Sync all preset sources - add new, update existing configs
  async seedPresets(): Promise<{
    added: string[];
    updated: string[];
    skipped: string[];
  }> {
    const presets = getAllPresets();
    const existingSources = await this.getSources();

    const added: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    for (const preset of presets) {
      // Ищем существующий источник по URL или имени
      const existing = existingSources.find(
        (s) => s.url === preset.url || s.name === preset.name
      );

      if (existing) {
        // Проверяем нужно ли обновлять конфиг
        const configChanged =
          JSON.stringify(existing.config) !== JSON.stringify(preset.config) ||
          existing.url !== preset.url;

        if (configChanged) {
          try {
            await this.updateSource(existing.id, {
              url: preset.url,
              config: preset.config,
            });
            updated.push(preset.name);
            console.log(`[NewsService] Updated preset source: ${preset.name}`);
          } catch (error) {
            console.error(
              `[NewsService] Failed to update preset ${preset.name}:`,
              error
            );
          }
        } else {
          skipped.push(preset.name);
        }
        continue;
      }

      try {
        await this.createSource({
          name: preset.name,
          type: preset.type,
          url: preset.url,
          category: preset.category,
          config: preset.config,
        });
        added.push(preset.name);
        console.log(`[NewsService] Added preset source: ${preset.name}`);
      } catch (error) {
        console.error(
          `[NewsService] Failed to add preset ${preset.name}:`,
          error
        );
      }
    }

    return { added, updated, skipped };
  },
};
