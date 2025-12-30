import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { polymarketService } from "../services/polymarket.service";

const polymarket = new Hono();

// GET /api/polymarket/events - получить события из БД
polymarket.get(
  "/events",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(50),
      offset: z.coerce.number().optional().default(0),
      active: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
      closed: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
      tag: z.string().optional(),
      search: z.string().optional(),
      minVolume: z.coerce.number().optional(),
    })
  ),
  async (c) => {
    try {
      const params = c.req.valid("query");
      const events = await polymarketService.getStoredEvents(params);
      return c.json(events);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/events/:id - получить событие с маркетами
polymarket.get("/events/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const event = await polymarketService.getStoredEventWithMarkets(id);

    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    return c.json(event);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// GET /api/polymarket/finance - события по финансовым темам
polymarket.get(
  "/finance",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(50),
      offset: z.coerce.number().optional().default(0),
    })
  ),
  async (c) => {
    try {
      const params = c.req.valid("query");
      const events = await polymarketService.getFinanceEvents(params);
      return c.json(events);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/stats - статистика по сохранённым данным
polymarket.get("/stats", async (c) => {
  try {
    const stats = await polymarketService.getStats();
    return c.json(stats);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// GET /api/polymarket/tags - получить теги с Polymarket API
polymarket.get("/tags", async (c) => {
  try {
    const tags = await polymarketService.fetchTags();
    return c.json(tags);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// GET /api/polymarket/fetch - получить события напрямую с API (без сохранения)
polymarket.get(
  "/fetch",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(50),
      offset: z.coerce.number().optional().default(0),
      closed: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
      active: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true")),
      tag: z.string().optional(),
    })
  ),
  async (c) => {
    try {
      const params = c.req.valid("query");
      const events = await polymarketService.fetchEvents(params);
      return c.json(events);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/search - поиск событий на Polymarket
polymarket.get(
  "/search",
  zValidator(
    "query",
    z.object({
      q: z.string().min(1),
    })
  ),
  async (c) => {
    try {
      const { q } = c.req.valid("query");
      const events = await polymarketService.searchEvents(q);
      return c.json(events);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// POST /api/polymarket/sync - запустить синхронизацию данных
polymarket.post(
  "/sync",
  zValidator(
    "json",
    z
      .object({
        closed: z.boolean().optional(),
        active: z.boolean().optional(),
        tag: z.string().optional(),
        limit: z.number().optional(),
      })
      .optional()
  ),
  async (c) => {
    try {
      const params = c.req.valid("json") ?? {};
      const syncId = await polymarketService.syncEvents(params);
      return c.json({ syncId, status: "started" });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/sync/:id - статус синхронизации
polymarket.get("/sync/:id", (c) => {
  const id = c.req.param("id");
  const progress = polymarketService.getSyncProgress(id);

  if (!progress) {
    return c.json({ error: "Sync not found" }, 404);
  }

  return c.json(progress);
});

// GET /api/polymarket/sync/:id/stream - SSE стрим прогресса синхронизации
polymarket.get("/sync/:id/stream", async (c) => {
  const id = c.req.param("id");

  return streamSSE(c, async (stream) => {
    let lastSaved = 0;

    const sendProgress = () => {
      const progress = polymarketService.getSyncProgress(id);
      if (progress && progress.savedEvents !== lastSaved) {
        lastSaved = progress.savedEvents;
        stream.writeSSE({
          data: JSON.stringify({
            status: progress.status,
            totalFetched: progress.totalFetched,
            savedEvents: progress.savedEvents,
            savedMarkets: progress.savedMarkets,
            error: progress.error,
          }),
          event: "progress",
        });
      }
      return progress;
    };

    while (true) {
      const progress = sendProgress();

      if (!progress) {
        stream.writeSSE({ data: "Sync not found", event: "error" });
        break;
      }

      if (progress.status === "completed") {
        stream.writeSSE({
          data: JSON.stringify({
            status: "completed",
            savedEvents: progress.savedEvents,
            savedMarkets: progress.savedMarkets,
          }),
          event: "done",
        });
        break;
      }

      if (progress.status === "failed") {
        stream.writeSSE({
          data: JSON.stringify({ status: "failed", error: progress.error }),
          event: "error",
        });
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
});

// GET /api/polymarket/opportunities - лучшие возможности (активные маркеты с высоким volume24hr)
polymarket.get(
  "/opportunities",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(20),
    })
  ),
  async (c) => {
    try {
      const params = c.req.valid("query");
      const opportunities = await polymarketService.getOpportunities(params);
      return c.json(opportunities);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/trending - трендовые события
polymarket.get(
  "/trending",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(10),
    })
  ),
  async (c) => {
    try {
      const params = c.req.valid("query");
      const trending = await polymarketService.getTrendingEvents(params);
      return c.json(trending);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/markets/:id/history - история цен маркета
polymarket.get(
  "/markets/:id/history",
  zValidator(
    "query",
    z.object({
      interval: z.enum(["1h", "6h", "1d", "max"]).optional().default("1d"),
    })
  ),
  async (c) => {
    try {
      const marketId = c.req.param("id");
      const { interval } = c.req.valid("query");

      const market = await polymarketService.getMarketWithTokenId(marketId);
      if (!market) {
        return c.json({ error: "Market not found" }, 404);
      }

      const tokenIds = market.clobTokenIds as string[] | null;
      if (!tokenIds || tokenIds.length === 0) {
        return c.json({ error: "No token IDs for this market" }, 400);
      }

      // Берём первый токен (Yes outcome)
      const tokenId = tokenIds[0];
      if (!tokenId) {
        return c.json({ error: "No token ID found" }, 400);
      }
      const history = await polymarketService.getPriceHistory(
        tokenId,
        interval
      );

      return c.json({
        marketId,
        tokenId,
        interval,
        history,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/context/:symbol - контекст Polymarket для символа (для LLM)
polymarket.get(
  "/context/:symbol",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(5),
    })
  ),
  async (c) => {
    try {
      const symbol = c.req.param("symbol");
      const { limit } = c.req.valid("query");

      const { polymarketCorrelationService } = await import(
        "../services/polymarket-correlation.service"
      );

      const context =
        await polymarketCorrelationService.buildContextForSymbol(symbol);

      // Форматируем для фронта
      return c.json({
        symbol,
        events: context.events.slice(0, limit).map((e) => ({
          title: e.title,
          probability: e.probability,
          probabilityChange24h: e.probabilityChange24h,
          volume: e.volume,
          relevance: e.relevance,
        })),
        marketSentiment: context.marketSentiment,
        smartMoney: context.events[0]?.smartMoney ?? null,
        summary: {
          totalEvents: context.events.length,
          avgProbability:
            context.events.length > 0
              ? context.events.reduce((sum, e) => sum + e.probability, 0) /
                context.events.length
              : 0,
          avgProbabilityChange:
            context.events.length > 0
              ? context.events.reduce(
                  (sum, e) => sum + e.probabilityChange24h,
                  0
                ) / context.events.length
              : 0,
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/intelligence - агрегированная статистика для дашборда
polymarket.get("/intelligence", async (c) => {
  try {
    const { polymarketCorrelationService } = await import(
      "../services/polymarket-correlation.service"
    );

    // Получаем топ события с активностью
    const opportunities = await polymarketService.getOpportunities({
      limit: 50,
    });

    // Анализируем смарт мани для топ маркетов
    const topMarkets = opportunities.slice(0, 10);
    const smartMoneyAnalysis = await Promise.all(
      topMarkets.map(async (m) => {
        const analysis = await polymarketCorrelationService.analyzeSmartMoney(
          m.id
        );
        return {
          marketId: m.id,
          question: m.question,
          probability: m.outcomePrices
            ? Number.parseFloat((m.outcomePrices as string[])[0] ?? "0")
            : 0,
          ...analysis,
        };
      })
    );

    // Считаем статистику по вероятностям и изменениям
    const stats = await polymarketService.getStats();

    // Группируем по сентименту
    const bullishEvents = smartMoneyAnalysis.filter(
      (a) => a.sentiment === "bullish"
    ).length;
    const bearishEvents = smartMoneyAnalysis.filter(
      (a) => a.sentiment === "bearish"
    ).length;
    const neutralEvents = smartMoneyAnalysis.filter(
      (a) => a.sentiment === "neutral"
    ).length;

    // Получаем события с наибольшим изменением вероятности
    const eventsWithChanges = await Promise.all(
      topMarkets.slice(0, 5).map(async (m) => {
        const changes = await polymarketService.getProbabilityChanges(m.id, 24);
        return {
          id: m.id,
          question: m.question,
          change24h: changes?.change ?? 0,
          currentProbability: changes?.endProbability ?? 0,
        };
      })
    );

    // Топ событие по изменению
    const topCorrelatedEvent = eventsWithChanges.sort(
      (a, b) => Math.abs(b.change24h) - Math.abs(a.change24h)
    )[0];

    // Средний alignment
    const avgProbabilityChange =
      eventsWithChanges.reduce((sum, e) => sum + e.change24h, 0) /
      eventsWithChanges.length;

    // Определяем общий alignment (-1 to 1)
    let overallAlignment = 0;
    if (avgProbabilityChange > 0.05) overallAlignment = 0.8;
    else if (avgProbabilityChange > 0.02) overallAlignment = 0.5;
    else if (avgProbabilityChange > 0) overallAlignment = 0.2;
    else if (avgProbabilityChange > -0.02) overallAlignment = -0.2;
    else if (avgProbabilityChange > -0.05) overallAlignment = -0.5;
    else overallAlignment = -0.8;

    return c.json({
      overallAlignment,
      sentimentDistribution: {
        bullish: bullishEvents,
        bearish: bearishEvents,
        neutral: neutralEvents,
      },
      avgProbabilityChange,
      topCorrelatedEvent: topCorrelatedEvent
        ? {
            question: topCorrelatedEvent.question,
            probability: topCorrelatedEvent.currentProbability,
            change24h: topCorrelatedEvent.change24h,
          }
        : null,
      stats: {
        totalEvents: stats.totalEvents,
        totalMarkets: stats.totalMarkets,
        activeMarkets: stats.activeEvents,
      },
      smartMoneySignals: smartMoneyAnalysis.slice(0, 5).map((a) => ({
        question: a.question,
        sentiment: a.sentiment ?? "neutral",
        confidence: a.topHoldersConcentration
          ? a.topHoldersConcentration / 100
          : 0.5,
        topHoldersBias: a.topHoldersConcentration ?? 0,
      })),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// GET /api/polymarket/markets/:id/snapshots - история снимков вероятности
polymarket.get(
  "/markets/:id/snapshots",
  zValidator(
    "query",
    z.object({
      hours: z.coerce.number().optional().default(24),
    })
  ),
  async (c) => {
    try {
      const marketId = c.req.param("id");
      const { hours } = c.req.valid("query");

      const changes = await polymarketService.getProbabilityChanges(
        marketId,
        hours
      );

      return c.json({
        marketId,
        hours,
        ...changes,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/markets/:id/comments - комментарии к событию
polymarket.get(
  "/markets/:id/comments",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(20),
    })
  ),
  async (c) => {
    try {
      const marketId = c.req.param("id");
      const { limit } = c.req.valid("query");

      // Получаем eventId из маркета
      const market = await polymarketService.getMarketWithTokenId(marketId);
      if (!market) {
        return c.json({ error: "Market not found" }, 404);
      }

      const comments = await polymarketService.getRecentComments(
        market.eventId,
        limit
      );

      return c.json({
        marketId,
        eventId: market.eventId,
        comments,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

// GET /api/polymarket/markets/:id/holders - топ холдеры маркета
polymarket.get(
  "/markets/:id/holders",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional().default(10),
    })
  ),
  async (c) => {
    try {
      const marketId = c.req.param("id");
      const { limit } = c.req.valid("query");

      const holders = await polymarketService.getTopHolders(marketId, limit);

      return c.json({
        marketId,
        holders,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Unknown error" },
        500
      );
    }
  }
);

export default polymarket;
