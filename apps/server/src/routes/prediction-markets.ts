import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getUserFromContext, requireAuth } from "../middleware";
import {
  marketGeneratorService,
  marketService,
} from "../services/prediction-market";

const markets = new Hono();

// ===== Schemas =====

const paginationSchema = z.object({
  limit: z.coerce.number().optional(),
  offset: z.coerce.number().optional(),
});

const marketFiltersSchema = paginationSchema.extend({
  status: z
    .enum(["pending", "active", "paused", "resolved", "cancelled"])
    .optional(),
  category: z
    .enum(["macro", "crypto", "corporate", "geo", "commodity", "other"])
    .optional(),
});

const createMarketSchema = z.object({
  question: z.string().min(10).max(500),
  description: z.string().optional(),
  category: z.enum([
    "macro",
    "crypto",
    "corporate",
    "geo",
    "commodity",
    "other",
  ]),
  resolutionCriteria: z.object({
    type: z.enum(["price", "date", "event", "announcement", "manual"]),
    description: z.string(),
    source: z.string().optional(),
    targetValue: z.number().optional(),
    targetDate: z.string().optional(),
  }),
  resolvesAt: z.string().transform((s) => new Date(s)),
  relatedSymbols: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const buySchema = z.object({
  side: z.enum(["yes", "no"]),
  amount: z.number().positive(),
});

const sellSchema = z.object({
  side: z.enum(["yes", "no"]),
  shares: z.number().positive(),
});

const resolveSchema = z.object({
  outcome: z.enum(["yes", "no"]),
  notes: z.string().optional(),
});

// ===== Public Routes =====

// List markets
markets.get("/", zValidator("query", marketFiltersSchema), async (c) => {
  const filters = c.req.valid("query");
  const result = await marketService.getAll(filters);
  return c.json(result);
});

// Get trending markets
markets.get("/trending", async (c) => {
  const limit = Number(c.req.query("limit") ?? 10);
  const trending = await marketService.getTrending(limit);
  return c.json({ markets: trending });
});

// Get stats
markets.get("/stats", async (c) => {
  const stats = await marketService.getStats();
  return c.json(stats);
});

// Get market by ID
markets.get("/:id", async (c) => {
  const id = c.req.param("id");
  const market = await marketService.getById(id);
  return c.json(market);
});

// Get market trades
markets.get("/:id/trades", zValidator("query", paginationSchema), async (c) => {
  const id = c.req.param("id");
  const { limit } = c.req.valid("query");
  const trades = await marketService.getMarketTrades(id, limit ?? 50);
  return c.json({ trades });
});

// Get market positions breakdown
markets.get("/:id/positions", async (c) => {
  const id = c.req.param("id");
  const positions = await marketService.getMarketPositions(id);
  return c.json(positions);
});

// ===== Protected Routes =====

// Create market
markets.post(
  "/",
  requireAuth,
  zValidator("json", createMarketSchema),
  async (c) => {
    const user = getUserFromContext(c);
    const data = c.req.valid("json");

    const market = await marketService.create({
      ...data,
      createdBy: user.id,
      creationType: "user",
    });

    return c.json(market, 201);
  }
);

// Buy shares
markets.post(
  "/:id/buy",
  requireAuth,
  zValidator("json", buySchema),
  async (c) => {
    const user = getUserFromContext(c);
    const id = c.req.param("id");
    const { side, amount } = c.req.valid("json");

    const result = await marketService.buy(id, user.id, side, amount);

    return c.json({
      trade: result.trade,
      position: result.position,
      newPrice: result.newPrice,
    });
  }
);

// Sell shares
markets.post(
  "/:id/sell",
  requireAuth,
  zValidator("json", sellSchema),
  async (c) => {
    const user = getUserFromContext(c);
    const id = c.req.param("id");
    const { side, shares } = c.req.valid("json");

    const result = await marketService.sell(id, user.id, side, shares);

    return c.json({
      trade: result.trade,
      proceeds: result.proceeds,
      newPrice: result.newPrice,
    });
  }
);

// Resolve market (admin only - for now just requires auth)
markets.post(
  "/:id/resolve",
  requireAuth,
  zValidator("json", resolveSchema),
  async (c) => {
    const id = c.req.param("id");
    const { outcome, notes } = c.req.valid("json");

    const market = await marketService.resolve(id, outcome, notes);

    return c.json(market);
  }
);

// Cancel market
markets.post("/:id/cancel", requireAuth, async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ reason?: string }>();

  await marketService.cancel(id, body.reason);

  return c.json({ message: "Market cancelled" });
});

// Activate market
markets.post("/:id/activate", requireAuth, async (c) => {
  const id = c.req.param("id");
  await marketService.activate(id);
  return c.json({ message: "Market activated" });
});

// Get my positions
markets.get("/me/positions", requireAuth, async (c) => {
  const user = getUserFromContext(c);
  const positions = await marketService.getUserPositions(user.id);
  return c.json(positions);
});

// Get my trades
markets.get("/me/trades", requireAuth, async (c) => {
  const user = getUserFromContext(c);
  const limit = Number(c.req.query("limit") ?? 50);
  const trades = await marketService.getUserTrades(user.id, limit);
  return c.json({ trades });
});

// ===== AI Generation =====

// Generate markets from article
markets.post("/generate/:articleId", requireAuth, async (c) => {
  const articleId = c.req.param("articleId");
  const result = await marketGeneratorService.generateAndSave(articleId);
  return c.json(result);
});

// Process recent articles
markets.post("/generate/batch", requireAuth, async (c) => {
  const hoursBack = Number(c.req.query("hours") ?? 24);
  const result = await marketGeneratorService.processRecentArticles(hoursBack);
  return c.json(result);
});

export default markets;
