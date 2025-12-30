import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { NotFoundError } from "../middleware";
import { marketService } from "../services/market/market.service";

const market = new Hono();

// Validation schemas
const paginationSchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const assetsQuerySchema = paginationSchema.extend({
  marketType: z.string().optional(),
  sector: z.string().optional(),
});

const timeframeSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d", "1w"]);

const candlesQuerySchema = z.object({
  timeframe: timeframeSchema.default("1h"),
  limit: z.coerce.number().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
});

const indicatorsQuerySchema = z.object({
  timeframe: timeframeSchema.default("1h"),
  types: z.string().optional(),
});

const trendsQuerySchema = paginationSchema.extend({
  marketType: z.string().optional(),
  trendType: z.string().optional(),
  strength: z.string().optional(),
});

const opportunitiesQuerySchema = paginationSchema.extend({
  marketType: z.string().optional(),
  direction: z.enum(["long", "short"]).optional(),
  minScore: z.coerce.number().optional(),
});

const analyzeBodySchema = z.object({
  symbol: z.string(),
  timeframe: timeframeSchema.default("1h"),
});

const collectBodySchema = z.object({
  timeframe: timeframeSchema.default("1h"),
  source: z.enum(["binance", "yahoo", "moex_iss", "all"]).default("all"),
  topCount: z.number().min(1).max(100).default(50),
  limit: z.number().min(1).max(1000).default(200),
});

// ===== Assets =====

market.get("/assets", zValidator("query", assetsQuerySchema), async (c) => {
  const filters = c.req.valid("query");
  const result = await marketService.getAssets(
    filters as Parameters<typeof marketService.getAssets>[0]
  );
  return c.json(result);
});

market.get("/assets/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const result = await marketService.getAssetBySymbol(symbol);

  if (!result) {
    throw new NotFoundError("Asset");
  }

  return c.json(result);
});

// ===== Candles =====

market.get(
  "/candles/:symbol",
  zValidator("query", candlesQuerySchema),
  async (c) => {
    const symbol = c.req.param("symbol");
    const filters = c.req.valid("query");

    const result = await marketService.getCandles(symbol, {
      ...filters,
      startTime: filters.startTime ? new Date(filters.startTime) : undefined,
      endTime: filters.endTime ? new Date(filters.endTime) : undefined,
    });

    if (!result) {
      throw new NotFoundError("Asset");
    }

    return c.json(result);
  }
);

// ===== Indicators =====

market.get(
  "/indicators/:symbol",
  zValidator("query", indicatorsQuerySchema),
  async (c) => {
    const symbol = c.req.param("symbol");
    const { timeframe, types } = c.req.valid("query");

    const result = await marketService.getIndicators(symbol, {
      timeframe,
      types: types?.split(",") as (
        | "rsi"
        | "macd"
        | "bollinger"
        | "ema"
        | "sma"
        | "adx"
        | "atr"
        | "volume_profile"
        | "support_resistance"
      )[],
    });

    if (!result) {
      throw new NotFoundError("Asset");
    }

    return c.json(result);
  }
);

// ===== Trends =====

market.get("/trends", zValidator("query", trendsQuerySchema), async (c) => {
  const filters = c.req.valid("query");
  const trends = await marketService.getTrends(
    filters as Parameters<typeof marketService.getTrends>[0]
  );
  return c.json({ trends });
});

// ===== Opportunities =====

market.get(
  "/opportunities",
  zValidator("query", opportunitiesQuerySchema),
  async (c) => {
    const filters = c.req.valid("query");
    const opportunities = await marketService.getOpportunities(
      filters as Parameters<typeof marketService.getOpportunities>[0]
    );
    return c.json({ opportunities });
  }
);

// ===== Overview =====

market.get("/overview", async (c) => {
  const overview = await marketService.getOverview();
  return c.json(overview);
});

// ===== Heatmap =====

market.get("/heatmap", async (c) => {
  const heatmap = await marketService.getHeatmap();
  return c.json(heatmap);
});

// ===== Analysis =====

market.post("/analyze", zValidator("json", analyzeBodySchema), async (c) => {
  const { symbol, timeframe } = c.req.valid("json");
  const result = await marketService.analyze(symbol, timeframe);
  return c.json(result);
});

// ===== Scheduler Control =====

market.get("/scheduler/status", async (c) => {
  return c.json(marketService.getSchedulerStatus());
});

market.post("/scheduler/start", async (c) => {
  marketService.startScheduler();
  return c.json({
    message: "Scheduler started",
    status: marketService.getSchedulerStatus(),
  });
});

market.post("/scheduler/stop", async (c) => {
  marketService.stopScheduler();
  return c.json({
    message: "Scheduler stopped",
    status: marketService.getSchedulerStatus(),
  });
});

// ===== Collection =====

market.post("/collect", zValidator("json", collectBodySchema), async (c) => {
  const params = c.req.valid("json");
  const result = await marketService.collect(params);
  return c.json(result);
});

// ===== Sources =====

market.get("/sources", async (c) => {
  const sources = marketService.getSources();
  return c.json({ sources });
});

export default market;
