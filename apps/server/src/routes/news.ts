import { zValidator } from "@hono/zod-validator";
import { db, newsAnalysis, newsSource } from "@trader/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { openaiService } from "../services/llm";
import { newsService } from "../services/news";

const news = new Hono();

// GET /api/news/articles - список статей
news.get(
  "/articles",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
      category: z.string().optional(),
      symbols: z.string().optional(),
      hoursAgo: z.coerce.number().optional(),
      sourceId: z.string().optional(),
    })
  ),
  async (c) => {
    const params = c.req.valid("query");
    const articles = await newsService.getArticles({
      ...params,
      symbols: params.symbols?.split(","),
    });
    return c.json(articles);
  }
);

// GET /api/news/articles/:id - детали статьи с анализом
news.get("/articles/:id", async (c) => {
  const articleId = c.req.param("id");
  const article = await newsService.getArticleWithAnalysis(articleId);
  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }
  return c.json(article);
});

// POST /api/news/articles/:id/analyze - анализ статьи через LLM
news.post("/articles/:id/analyze", async (c) => {
  if (!openaiService.isConfigured()) {
    return c.json({ error: "OpenAI API key not configured" }, 400);
  }

  const articleId = c.req.param("id");
  const article = await newsService.getArticle(articleId);

  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }

  // Получаем source для имени
  const [source] = await db
    .select()
    .from(newsSource)
    .where(eq(newsSource.id, article.sourceId));

  // Создаём запись анализа
  const [analysis] = await db
    .insert(newsAnalysis)
    .values({
      articleId: article.id,
      status: "processing",
    })
    .returning();

  try {
    const llmResponse = await openaiService.analyzeNews({
      title: article.title,
      content: article.content || undefined,
      summary: article.summary || undefined,
      source: source?.name || "Unknown",
      publishedAt: article.publishedAt,
      symbols: article.symbols || undefined,
    });

    // Сохраняем результат
    const [updated] = await db
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
      .where(eq(newsAnalysis.id, analysis!.id))
      .returning();

    return c.json(updated);
  } catch (error) {
    await db
      .update(newsAnalysis)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(newsAnalysis.id, analysis!.id));

    return c.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      500
    );
  }
});

// GET /api/news/sources - список источников
news.get("/sources", async (c) => {
  const sources = await newsService.getSources();
  return c.json(sources);
});

// POST /api/news/sources - создать источник
news.post(
  "/sources",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1),
      type: z.enum(["rss", "api", "twitter", "telegram", "web_scraper"]),
      url: z.string().url(),
      apiKey: z.string().optional(),
      category: z
        .enum([
          "crypto",
          "stocks",
          "forex",
          "commodities",
          "macro",
          "regulation",
          "technology",
          "other",
        ])
        .optional(),
      fetchInterval: z.number().min(60).optional(),
      config: z
        .object({
          newsListSelector: z.string().optional(),
          articleLinkSelector: z.string().optional(),
          titleSelector: z.string().optional(),
          contentSelector: z.string().optional(),
          dateSelector: z.string().optional(),
          authorSelector: z.string().optional(),
          imageSelector: z.string().optional(),
          summarySelector: z.string().optional(),
          watchInterval: z.number().optional(),
          waitForSelector: z.string().optional(),
          channelUsername: z.string().optional(),
        })
        .optional(),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    const source = await newsService.createSource(data);
    return c.json(source, 201);
  }
);

// PUT /api/news/sources/:id - обновить источник
news.put(
  "/sources/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).optional(),
      url: z.string().url().optional(),
      enabled: z.boolean().optional(),
      fetchInterval: z.number().min(60).optional(),
      config: z
        .object({
          newsListSelector: z.string().optional(),
          articleLinkSelector: z.string().optional(),
          titleSelector: z.string().optional(),
          contentSelector: z.string().optional(),
          dateSelector: z.string().optional(),
          authorSelector: z.string().optional(),
          imageSelector: z.string().optional(),
          summarySelector: z.string().optional(),
          watchInterval: z.number().optional(),
          waitForSelector: z.string().optional(),
          channelUsername: z.string().optional(),
        })
        .optional(),
    })
  ),
  async (c) => {
    const sourceId = c.req.param("id");
    const data = c.req.valid("json");
    const source = await newsService.updateSource(sourceId, data);
    if (!source) {
      return c.json({ error: "Source not found" }, 404);
    }
    return c.json(source);
  }
);

// DELETE /api/news/sources/:id - удалить источник
news.delete("/sources/:id", async (c) => {
  const sourceId = c.req.param("id");
  await newsService.deleteSource(sourceId);
  return c.json({ success: true });
});

// POST /api/news/sources/:id/fetch - принудительный фетч
news.post("/sources/:id/fetch", async (c) => {
  const sourceId = c.req.param("id");
  const result = await newsService.fetchSource(sourceId);
  return c.json(result);
});

// POST /api/news/fetch-all - фетч всех источников
news.post("/fetch-all", async (c) => {
  const results = await newsService.fetchAllSources();
  return c.json({ results });
});

// GET /api/news/stats - статистика
news.get("/stats", async (c) => {
  const stats = await newsService.getStats();
  return c.json(stats);
});

// Scheduler management
import { newsScheduler } from "../services/news";
import {
  getAllPresets,
  getPresetSource,
  type PresetSourceKey,
} from "../services/news/sources-config";

// GET /api/news/scheduler/status
news.get("/scheduler/status", (c) => {
  return c.json({
    running: newsScheduler.isRunning(),
    realtimeRunning: newsScheduler.isRealtimeRunning(),
  });
});

// POST /api/news/scheduler/start
news.post("/scheduler/start", (c) => {
  newsScheduler.start();
  return c.json({ success: true, running: true });
});

// POST /api/news/scheduler/stop
news.post("/scheduler/stop", (c) => {
  newsScheduler.stop();
  return c.json({ success: true, running: false });
});

// === Realtime endpoints ===

// GET /api/news/realtime/status
news.get("/realtime/status", (c) => {
  const status = newsScheduler.getRealtimeStatus();
  return c.json(status);
});

// POST /api/news/realtime/start
news.post("/realtime/start", async (c) => {
  try {
    await newsScheduler.startRealtime();
    return c.json({
      success: true,
      status: newsScheduler.getRealtimeStatus(),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to start" },
      500
    );
  }
});

// POST /api/news/realtime/stop
news.post("/realtime/stop", async (c) => {
  try {
    await newsScheduler.stopRealtime();
    return c.json({
      success: true,
      status: newsScheduler.getRealtimeStatus(),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to stop" },
      500
    );
  }
});

// POST /api/news/realtime/sources/:id/start
news.post("/realtime/sources/:id/start", async (c) => {
  const sourceId = c.req.param("id");
  try {
    await newsScheduler.startSourceRealtime(sourceId);
    return c.json({ success: true, sourceId });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start source",
      },
      500
    );
  }
});

// POST /api/news/realtime/sources/:id/stop
news.post("/realtime/sources/:id/stop", async (c) => {
  const sourceId = c.req.param("id");
  try {
    await newsScheduler.stopSourceRealtime(sourceId);
    return c.json({ success: true, sourceId });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Failed to stop source",
      },
      500
    );
  }
});

// === Preset sources ===

// GET /api/news/presets
news.get("/presets", (c) => {
  const presets = getAllPresets();
  return c.json(presets);
});

// POST /api/news/presets/:key/add
news.post("/presets/:key/add", async (c) => {
  const key = c.req.param("key") as PresetSourceKey;
  const preset = getPresetSource(key);

  if (!preset) {
    return c.json({ error: "Preset not found" }, 404);
  }

  // Создаём источник из пресета
  const source = await newsService.createSource({
    name: preset.name,
    type: preset.type,
    url: preset.url,
    category: preset.category,
    config: preset.config,
  });

  return c.json(source, 201);
});

// POST /api/news/presets/sync - синхронизация пресетов (обновляет конфиги существующих)
news.post("/presets/sync", async (c) => {
  const presets = getAllPresets();
  const existingSources = await newsService.getSources();

  const updated: string[] = [];
  const added: string[] = [];

  for (const preset of presets) {
    // Ищем существующий источник по URL или имени
    const existing = existingSources.find(
      (s) => s.url === preset.url || s.name === preset.name
    );

    if (existing) {
      // Обновляем конфиг
      await newsService.updateSource(existing.id, {
        url: preset.url,
        config: preset.config,
      });
      updated.push(preset.name);
    } else {
      // Создаём новый
      await newsService.createSource({
        name: preset.name,
        type: preset.type,
        url: preset.url,
        category: preset.category,
        config: preset.config,
      });
      added.push(preset.name);
    }
  }

  return c.json({ updated, added });
});

export default news;
