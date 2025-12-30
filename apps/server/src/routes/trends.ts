import { zValidator } from "@hono/zod-validator";
import { db, newsTag, tagMention } from "@trader/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  anomalyDetectorService,
  graphBuilderService,
  tagExtractorService,
  trendAggregatorService,
} from "../services/trends";

const trends = new Hono();

// ==================== TAGS ====================

// GET /api/trends/tags - список тегов с фильтрами
trends.get(
  "/tags",
  zValidator(
    "query",
    z.object({
      type: z.enum(["entity", "topic", "event", "region"]).optional(),
      subtype: z.string().optional(),
      search: z.string().optional(),
      minMentions: z.coerce.number().optional(),
      limit: z.coerce.number().default(50),
      offset: z.coerce.number().default(0),
      orderBy: z
        .enum(["mentions", "sentiment", "lastSeen"])
        .default("mentions"),
    })
  ),
  async (c) => {
    const { type, subtype, search, minMentions, limit, offset, orderBy } =
      c.req.valid("query");

    const conditions = [];

    if (type) {
      conditions.push(eq(newsTag.type, type));
    }
    if (subtype) {
      conditions.push(eq(newsTag.subtype, subtype));
    }
    if (search) {
      conditions.push(
        sql`(${newsTag.name} ILIKE ${"%" + search + "%"} OR ${newsTag.normalizedName} ILIKE ${"%" + search + "%"})`
      );
    }
    if (minMentions) {
      conditions.push(gte(sql`${newsTag.totalMentions}::numeric`, minMentions));
    }

    const orderByColumn =
      orderBy === "sentiment"
        ? desc(newsTag.avgSentiment)
        : orderBy === "lastSeen"
          ? desc(newsTag.lastSeenAt)
          : desc(sql`${newsTag.totalMentions}::numeric`);

    const tags = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        subtype: newsTag.subtype,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
        lastSeenAt: newsTag.lastSeenAt,
        aliases: newsTag.aliases,
      })
      .from(newsTag)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orderByColumn)
      .limit(limit)
      .offset(offset);

    return c.json({
      data: tags.map((t) => ({
        ...t,
        totalMentions: Number(t.totalMentions) || 0,
        avgSentiment: Number(t.avgSentiment) || 0,
      })),
      pagination: { limit, offset },
    });
  }
);

// GET /api/trends/tags/:id - детали тега + история
trends.get("/tags/:id", async (c) => {
  const tagId = c.req.param("id");

  const [tag] = await db.select().from(newsTag).where(eq(newsTag.id, tagId));

  if (!tag) {
    return c.json({ error: "Tag not found" }, 404);
  }

  // Получаем историю тренда
  const timeline = await trendAggregatorService.getTagTimeline(
    tagId,
    "24h",
    30
  );

  // Получаем последние упоминания
  const recentMentions = await db
    .select({
      articleId: tagMention.articleId,
      sentiment: tagMention.sentiment,
      relevance: tagMention.relevance,
      context: tagMention.context,
      createdAt: tagMention.createdAt,
    })
    .from(tagMention)
    .where(eq(tagMention.tagId, tagId))
    .orderBy(desc(tagMention.createdAt))
    .limit(10);

  return c.json({
    tag: {
      ...tag,
      totalMentions: Number(tag.totalMentions) || 0,
      avgSentiment: Number(tag.avgSentiment) || 0,
    },
    timeline,
    recentMentions: recentMentions.map((m) => ({
      ...m,
      relevance: Number(m.relevance),
    })),
  });
});

// GET /api/trends/tags/:id/graph - эго-граф для тега
trends.get(
  "/tags/:id/graph",
  zValidator(
    "query",
    z.object({
      depth: z.coerce.number().default(2),
      minStrength: z.coerce.number().default(0.05),
    })
  ),
  async (c) => {
    const tagId = c.req.param("id");
    const { depth, minStrength } = c.req.valid("query");

    const graph = await graphBuilderService.buildEgoGraph(
      tagId,
      depth,
      minStrength
    );
    return c.json(graph);
  }
);

// ==================== HOT TRENDS ====================

// GET /api/trends/hot - топ растущих тегов
trends.get(
  "/hot",
  zValidator(
    "query",
    z.object({
      period: z.enum(["1h", "24h", "7d"]).default("24h"),
      limit: z.coerce.number().default(20),
    })
  ),
  async (c) => {
    const { period, limit } = c.req.valid("query");
    const hotTrends = await trendAggregatorService.getHotTrends(period, limit);
    return c.json(hotTrends);
  }
);

// ==================== GRAPH ====================

// GET /api/trends/graph - полный граф связей
trends.get(
  "/graph",
  zValidator(
    "query",
    z.object({
      minStrength: z.coerce.number().default(0.1),
      maxNodes: z.coerce.number().default(100),
      periodDays: z.coerce.number().default(7),
      tagType: z.enum(["entity", "topic", "event", "region"]).optional(),
    })
  ),
  async (c) => {
    const options = c.req.valid("query");
    const graph = await graphBuilderService.buildGraph(options);
    return c.json(graph);
  }
);

// GET /api/trends/graph/stats - статистика графа
trends.get("/graph/stats", async (c) => {
  const stats = await graphBuilderService.getGraphStats();
  return c.json(stats);
});

// GET /api/trends/graph/clusters - кластеры тем
trends.get(
  "/graph/clusters",
  zValidator(
    "query",
    z.object({
      minClusterSize: z.coerce.number().default(3),
    })
  ),
  async (c) => {
    const { minClusterSize } = c.req.valid("query");
    const clusters = await graphBuilderService.detectClusters(minClusterSize);
    return c.json(clusters);
  }
);

// GET /api/trends/graph/centrality - центральность узлов
trends.get("/graph/centrality", async (c) => {
  const centrality = await graphBuilderService.calculateCentrality();
  return c.json(centrality);
});

// ==================== PATH FINDING ====================

// GET /api/trends/graph/path - найти путь между двумя узлами
trends.get(
  "/graph/path",
  zValidator(
    "query",
    z.object({
      from: z.string(),
      to: z.string(),
      maxDepth: z.coerce.number().default(4),
      algorithm: z.enum(["bfs", "dijkstra", "all"]).default("dijkstra"),
    })
  ),
  async (c) => {
    const { from, to, maxDepth, algorithm } = c.req.valid("query");
    const { pathFinderService } = await import("../services/trends");

    if (algorithm === "all") {
      const paths = await pathFinderService.findAllPaths(from, to, {
        maxDepth,
        maxPaths: 5,
      });
      return c.json({ paths });
    }
    if (algorithm === "bfs") {
      const path = await pathFinderService.findShortestPath(from, to, {
        maxDepth,
      });
      if (!path) {
        return c.json({ error: "No path found" }, 404);
      }
      return c.json(path);
    }
    const path = await pathFinderService.findWeightedPath(from, to, {
      maxDepth,
    });
    if (!path) {
      return c.json({ error: "No path found" }, 404);
    }
    return c.json(path);
  }
);

// GET /api/trends/graph/relationship - анализ связи между двумя узлами
trends.get(
  "/graph/relationship",
  zValidator(
    "query",
    z.object({
      node1: z.string(),
      node2: z.string(),
    })
  ),
  async (c) => {
    const { node1, node2 } = c.req.valid("query");
    const { pathFinderService } = await import("../services/trends");

    const analysis = await pathFinderService.analyzeRelationship(node1, node2);
    return c.json(analysis);
  }
);

// GET /api/trends/graph/common-neighbors - общие соседи двух узлов
trends.get(
  "/graph/common-neighbors",
  zValidator(
    "query",
    z.object({
      node1: z.string(),
      node2: z.string(),
      minStrength: z.coerce.number().default(0.1),
    })
  ),
  async (c) => {
    const { node1, node2, minStrength } = c.req.valid("query");
    const { pathFinderService } = await import("../services/trends");

    const neighbors = await pathFinderService.findCommonNeighbors(
      node1,
      node2,
      minStrength
    );
    return c.json({ commonNeighbors: neighbors });
  }
);

// ==================== TIME TRAVEL ====================

// GET /api/trends/graph/historical - граф на определённую дату
trends.get(
  "/graph/historical",
  zValidator(
    "query",
    z.object({
      date: z.string().transform((s) => new Date(s)),
      minStrength: z.coerce.number().default(0.1),
      maxNodes: z.coerce.number().default(100),
    })
  ),
  async (c) => {
    const { date, minStrength, maxNodes } = c.req.valid("query");
    const graph = await graphBuilderService.buildGraphAtTime(date, {
      minStrength,
      maxNodes,
    });
    return c.json(graph);
  }
);

// GET /api/trends/graph/key-dates - ключевые даты для слайдера
trends.get(
  "/graph/key-dates",
  zValidator(
    "query",
    z.object({
      periodDays: z.coerce.number().default(30),
    })
  ),
  async (c) => {
    const { periodDays } = c.req.valid("query");
    const keyDates = await graphBuilderService.getKeyDates(periodDays);
    return c.json({ keyDates });
  }
);

// GET /api/trends/graph/diff - разница между двумя датами
trends.get(
  "/graph/diff",
  zValidator(
    "query",
    z.object({
      from: z.string().transform((s) => new Date(s)),
      to: z.string().transform((s) => new Date(s)),
      maxNodes: z.coerce.number().default(100),
    })
  ),
  async (c) => {
    const { from, to, maxNodes } = c.req.valid("query");
    const diff = await graphBuilderService.getGraphDiff(from, to, { maxNodes });
    return c.json(diff);
  }
);

// ==================== ALERTS ====================

// GET /api/trends/alerts - активные алерты
trends.get(
  "/alerts",
  zValidator(
    "query",
    z.object({
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      type: z
        .enum([
          "spike",
          "sentiment_shift",
          "new_entity",
          "anomaly",
          "volume_drop",
        ])
        .optional(),
      limit: z.coerce.number().default(50),
      unacknowledged: z.coerce.boolean().default(false),
    })
  ),
  async (c) => {
    const { severity, type, limit, unacknowledged } = c.req.valid("query");

    const alerts = await anomalyDetectorService.getActiveAlerts({
      severity: severity as "low" | "medium" | "high" | "critical" | undefined,
      type: type as
        | "spike"
        | "sentiment_shift"
        | "new_entity"
        | "anomaly"
        | "volume_drop"
        | undefined,
      limit,
      onlyUnacknowledged: unacknowledged,
    });

    return c.json(alerts);
  }
);

// GET /api/trends/alerts/stats - статистика алертов
trends.get("/alerts/stats", async (c) => {
  const stats = await anomalyDetectorService.getAlertStats();
  return c.json(stats);
});

// POST /api/trends/alerts/:id/acknowledge - подтверждение алерта
trends.post("/alerts/:id/acknowledge", async (c) => {
  const alertId = c.req.param("id");
  // TODO: получить userId из сессии
  const userId = "system";

  const success = await anomalyDetectorService.acknowledgeAlert(
    alertId,
    userId
  );

  if (!success) {
    return c.json({ error: "Alert not found" }, 404);
  }

  return c.json({ success: true });
});

// POST /api/trends/alerts/scan - запуск сканирования на аномалии
trends.post("/alerts/scan", async (c) => {
  const result = await anomalyDetectorService.runFullScan();
  return c.json(result);
});

// ==================== AI INSIGHTS ====================

// POST /api/trends/insights/entity/:entityId - AI анализ сущности
trends.post("/insights/entity/:entityId", async (c) => {
  const entityId = c.req.param("entityId");
  const { aiInsightsService } = await import("../services/trends");

  try {
    const result = await aiInsightsService.analyzeEntity(entityId);
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      500
    );
  }
});

// POST /api/trends/insights/cluster/:clusterId - AI анализ кластера
trends.post("/insights/cluster/:clusterId", async (c) => {
  const clusterId = c.req.param("clusterId");
  const { aiInsightsService } = await import("../services/trends");

  try {
    const result = await aiInsightsService.analyzeCluster(clusterId);
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      500
    );
  }
});

// POST /api/trends/insights/relationship - AI анализ связи между сущностями
trends.post(
  "/insights/relationship",
  zValidator(
    "json",
    z.object({
      entityId1: z.string(),
      entityId2: z.string(),
    })
  ),
  async (c) => {
    const { entityId1, entityId2 } = c.req.valid("json");
    const { aiInsightsService } = await import("../services/trends");

    try {
      const result = await aiInsightsService.analyzeRelationship(
        entityId1,
        entityId2
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Analysis failed" },
        500
      );
    }
  }
);

// POST /api/trends/insights/market - AI анализ рыночных трендов
trends.post("/insights/market", async (c) => {
  const { aiInsightsService } = await import("../services/trends");

  try {
    const result = await aiInsightsService.analyzeMarketTrends();
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      500
    );
  }
});

// ==================== EXTRACTION ====================

// POST /api/trends/extract/:articleId - извлечение тегов из статьи
trends.post("/extract/:articleId", async (c) => {
  const articleId = c.req.param("articleId");

  try {
    const result = await tagExtractorService.extractFromArticle(articleId);
    return c.json(result);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Extraction failed" },
      500
    );
  }
});

// POST /api/trends/extract-batch - пакетное извлечение
trends.post(
  "/extract-batch",
  zValidator(
    "json",
    z.object({
      limit: z.number().default(10),
    })
  ),
  async (c) => {
    const { limit } = c.req.valid("json");
    const result = await tagExtractorService.processUntaggedArticles(limit);
    return c.json(result);
  }
);

// ==================== AGGREGATION ====================

// POST /api/trends/aggregate - запуск агрегации трендов
trends.post(
  "/aggregate",
  zValidator(
    "json",
    z.object({
      period: z.enum(["1h", "24h", "7d"]).default("24h"),
    })
  ),
  async (c) => {
    const { period } = c.req.valid("json");
    const result = await trendAggregatorService.aggregateAllTags(period);
    return c.json(result);
  }
);

// POST /api/trends/update-aggregates - обновление агрегатов тегов
trends.post("/update-aggregates", async (c) => {
  const updated = await trendAggregatorService.updateAllTagAggregates();
  return c.json({ updated });
});

// ==================== STATS ====================

// GET /api/trends/stats - общая статистика
trends.get("/stats", async (c) => {
  const tagStats = await tagExtractorService.getTagStats();
  const graphStats = await graphBuilderService.getGraphStats();
  const alertStats = await anomalyDetectorService.getAlertStats();

  return c.json({
    tags: tagStats,
    graph: graphStats,
    alerts: alertStats,
  });
});

export default trends;
