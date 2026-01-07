import { db, newsAnalysis, newsArticle, newsSource } from "@trader/db";
import { eq } from "drizzle-orm";
import { openaiService } from "../llm";
import { newsService } from "./news.service";
import { telegramParser } from "./parsers/telegram.parser";
import { webScraperParser } from "./parsers/web-scraper.parser";
import { browserPool } from "./realtime/browser-pool";
import { newsEventEmitter } from "./realtime/event-emitter";
import type { ParsedArticle, RealtimeStatus } from "./types";
import { newsWebSocketServer } from "./websocket/server";

// Интервалы в миллисекундах
const FETCH_INTERVAL = 2 * 60 * 1000; // 2 минуты
const ANALYZE_INTERVAL = 60 * 1000; // 1 минута

let fetchTimer: ReturnType<typeof setInterval> | null = null;
let analyzeTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isRealtimeRunning = false;

// Ошибки realtime
const realtimeErrors: Array<{
  sourceId: string;
  error: string;
  timestamp: Date;
}> = [];

export const newsScheduler = {
  isRunning() {
    return isRunning;
  },

  isRealtimeRunning() {
    return isRealtimeRunning;
  },

  start() {
    if (isRunning) {
      console.log("[NewsScheduler] Already running");
      return;
    }

    console.log("[NewsScheduler] Starting...");
    isRunning = true;

    // Фетч новостей каждые 2 минуты (только для RSS источников)
    fetchTimer = setInterval(async () => {
      try {
        console.log("[NewsScheduler] Fetching news from RSS sources...");
        const results = await newsService.fetchAllSources();
        const totalArticles = results.reduce(
          (sum, r) => sum + r.articlesSaved,
          0
        );
        console.log(
          `[NewsScheduler] Fetched ${totalArticles} articles from ${results.length} sources`
        );
      } catch (error) {
        console.error("[NewsScheduler] Fetch error:", error);
      }
    }, FETCH_INTERVAL);

    // Анализ новых статей каждую минуту
    analyzeTimer = setInterval(async () => {
      if (!openaiService.isConfigured()) {
        return;
      }

      try {
        await this.analyzeUnprocessedArticles();
      } catch (error) {
        console.error("[NewsScheduler] Analysis error:", error);
      }
    }, ANALYZE_INTERVAL);

    // Первичный запуск через 10 секунд после старта
    setTimeout(() => {
      newsService.fetchAllSources().catch(console.error);
    }, 10_000);

    console.log("[NewsScheduler] Started successfully");
  },

  stop() {
    console.log("[NewsScheduler] Stopping...");
    if (fetchTimer) {
      clearInterval(fetchTimer);
      fetchTimer = null;
    }
    if (analyzeTimer) {
      clearInterval(analyzeTimer);
      analyzeTimer = null;
    }
    isRunning = false;
    console.log("[NewsScheduler] Stopped");
  },

  // === Realtime методы ===

  async startRealtime(): Promise<void> {
    if (isRealtimeRunning) {
      console.log("[NewsScheduler] Realtime already running");
      return;
    }

    console.log("[NewsScheduler] Starting realtime mode...");
    isRealtimeRunning = true;

    // Инициализируем WebSocket сервер
    newsWebSocketServer.initialize();

    // Получаем все включенные источники web_scraper и telegram типа
    const sources = await db
      .select()
      .from(newsSource)
      .where(eq(newsSource.enabled, true));

    const webScraperSources = sources.filter((s) => s.type === "web_scraper");
    const telegramSources = sources.filter((s) => s.type === "telegram");

    console.log(
      `[NewsScheduler] Found ${webScraperSources.length} web_scraper sources, ${telegramSources.length} telegram sources`
    );

    // Callback для сохранения статьи
    const onArticle = async (
      article: ParsedArticle,
      sourceId: string,
      sourceName: string
    ) => {
      try {
        // Сохраняем в БД
        const [saved] = await db
          .insert(newsArticle)
          .values({
            sourceId,
            externalId: article.externalId,
            url: article.url,
            title: article.title,
            content: article.content,
            summary: article.summary,
            author: article.author,
            imageUrl: article.imageUrl,
            symbols: article.symbols,
            publishedAt: article.publishedAt,
            metadata: article.metadata,
          })
          .onConflictDoNothing()
          .returning();

        if (saved) {
          console.log(
            `[NewsScheduler] Saved new article: ${article.title.slice(0, 50)}...`
          );
          newsEventEmitter.emitArticleSaved(
            { ...article, id: saved.id },
            sourceId,
            sourceName
          );
        }
      } catch (error) {
        console.error("[NewsScheduler] Error saving article:", error);
      }
    };

    // Запускаем web scraper watchers
    for (const source of webScraperSources) {
      try {
        await webScraperParser.startWatching(
          {
            id: source.id,
            url: source.url,
            config: source.config || undefined,
          },
          (article) => onArticle(article, source.id, source.name)
        );
      } catch (error) {
        console.error(
          `[NewsScheduler] Failed to start web scraper for ${source.name}:`,
          error
        );
        realtimeErrors.push({
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        });
      }
    }

    // Запускаем telegram watchers (только если настроены credentials)
    if (telegramSources.length > 0) {
      if (telegramParser.isConfigured()) {
        for (const source of telegramSources) {
          try {
            await telegramParser.startWatching(
              {
                id: source.id,
                url: source.url,
                config: source.config || undefined,
              },
              (article) => onArticle(article, source.id, source.name)
            );
          } catch (error) {
            console.error(
              `[NewsScheduler] Failed to start telegram for ${source.name}:`,
              error
            );
            realtimeErrors.push({
              sourceId: source.id,
              error: error instanceof Error ? error.message : String(error),
              timestamp: new Date(),
            });
          }
        }
      } else {
        console.log(
          `[NewsScheduler] Skipping ${telegramSources.length} telegram sources - not configured`
        );
      }
    }

    console.log("[NewsScheduler] Realtime mode started");
  },

  async stopRealtime(): Promise<void> {
    if (!isRealtimeRunning) {
      console.log("[NewsScheduler] Realtime not running");
      return;
    }

    console.log("[NewsScheduler] Stopping realtime mode...");

    // Останавливаем все watchers
    await webScraperParser.stopAllWatchers();
    await telegramParser.stopAllWatchers();

    // Очищаем browser pool
    await browserPool.cleanup();

    isRealtimeRunning = false;
    realtimeErrors.length = 0;

    console.log("[NewsScheduler] Realtime mode stopped");
  },

  async startSourceRealtime(sourceId: string): Promise<void> {
    const [source] = await db
      .select()
      .from(newsSource)
      .where(eq(newsSource.id, sourceId));

    if (!source) {
      throw new Error(`Source ${sourceId} not found`);
    }

    const onArticle = async (article: ParsedArticle) => {
      const [saved] = await db
        .insert(newsArticle)
        .values({
          sourceId,
          externalId: article.externalId,
          url: article.url,
          title: article.title,
          content: article.content,
          summary: article.summary,
          author: article.author,
          imageUrl: article.imageUrl,
          symbols: article.symbols,
          publishedAt: article.publishedAt,
          metadata: article.metadata,
        })
        .onConflictDoNothing()
        .returning();

      if (saved) {
        newsEventEmitter.emitArticleSaved(
          { ...article, id: saved.id },
          sourceId,
          source.name
        );
      }
    };

    if (source.type === "web_scraper") {
      await webScraperParser.startWatching(
        {
          id: source.id,
          url: source.url,
          config: source.config || undefined,
        },
        onArticle
      );
    } else if (source.type === "telegram") {
      await telegramParser.startWatching(
        {
          id: source.id,
          url: source.url,
          config: source.config || undefined,
        },
        onArticle
      );
    }
  },

  async stopSourceRealtime(sourceId: string): Promise<void> {
    await webScraperParser.stopWatching(sourceId);
    await telegramParser.stopWatching(sourceId);
  },

  getRealtimeStatus(): RealtimeStatus {
    return {
      isRunning: isRealtimeRunning,
      webScraperSources: webScraperParser.getWatchingCount(),
      telegramChannels: telegramParser.getWatchingCount(),
      connectedClients: newsWebSocketServer.getConnectedClientsCount(),
      errors: [...realtimeErrors],
    };
  },

  // === Analysis методы ===

  async analyzeUnprocessedArticles(limit = 3) {
    const unanalyzed = await newsService.getUnanalyzedArticles(limit);

    if (unanalyzed.length === 0) {
      return;
    }

    console.log(`[NewsScheduler] Analyzing ${unanalyzed.length} articles...`);

    for (const { article } of unanalyzed) {
      if (!article) continue;

      // Создаем запись анализа в статусе processing
      const [analysis] = await db
        .insert(newsAnalysis)
        .values({
          articleId: article.id,
          status: "processing",
        })
        .returning();

      try {
        // Получаем источник для имени
        const [source] = await db
          .select()
          .from(newsSource)
          .where(eq(newsSource.id, article.sourceId));

        const llmResponse = await openaiService.analyzeNews({
          title: article.title,
          content: article.content || undefined,
          summary: article.summary || undefined,
          source: source?.name || "Unknown",
          publishedAt: article.publishedAt,
          symbols: article.symbols || undefined,
        });

        // Сохраняем результат
        await db
          .update(newsAnalysis)
          .set({
            status: "completed",
            sentiment: llmResponse.result.sentiment,
            sentimentScore: String(llmResponse.result.sentimentScore),
            relevanceScore: String(llmResponse.result.relevanceScore),
            impactScore: String(llmResponse.result.impactScore),
            affectedAssets: llmResponse.result.affectedAssets,
            keyPoints: llmResponse.result.keyPoints,
            marketImplications: llmResponse.result.marketImplications,
            recommendation: llmResponse.result.recommendation,
            model: llmResponse.model,
            promptTokens: String(llmResponse.promptTokens),
            completionTokens: String(llmResponse.completionTokens),
            rawResponse: llmResponse.rawResponse,
            analyzedAt: new Date(),
          })
          .where(eq(newsAnalysis.id, analysis!.id));

        console.log(
          `[NewsScheduler] Analyzed article: ${article.title.substring(0, 50)}...`
        );

        // Emit high-impact news event if impactScore > 0.7
        if (llmResponse.result.impactScore > 0.7) {
          newsEventEmitter.emitHighImpactNews({
            articleId: article.id,
            title: article.title,
            sentiment: llmResponse.result.sentiment,
            impactScore: llmResponse.result.impactScore,
            affectedAssets: llmResponse.result.affectedAssets,
          });
          console.log(
            `[NewsScheduler] Emitted high-impact news event for: ${article.title.substring(0, 50)}... (impact: ${llmResponse.result.impactScore})`
          );
        }
      } catch (error) {
        await db
          .update(newsAnalysis)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          })
          .where(eq(newsAnalysis.id, analysis!.id));

        console.error("[NewsScheduler] Failed to analyze article:", error);
      }

      // Rate limiting для OpenAI - 2 секунды между запросами
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
};
