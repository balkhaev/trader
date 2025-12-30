import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import type { StrategyConfig } from "@trader/db";
import { Hono } from "hono";
import { z } from "zod";
import { strategyService } from "../services/strategy";

const strategyRoutes = new Hono();

// Helper to get user
async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

// Condition schemas
const indicatorConditionSchema = z.object({
  type: z.literal("indicator"),
  indicator: z.enum(["rsi", "macd", "bollinger", "sma", "ema", "adx", "atr"]),
  parameter: z.string(),
  period: z.number().optional(),
  operator: z.enum([
    ">",
    "<",
    ">=",
    "<=",
    "==",
    "crosses_above",
    "crosses_below",
  ]),
  value: z.union([z.number(), z.string()]),
});

const priceConditionSchema = z.object({
  type: z.literal("price"),
  comparison: z.enum(["close", "open", "high", "low", "volume"]),
  operator: z.enum([">", "<", ">=", "<=", "=="]),
  value: z.union([z.number(), z.string()]),
});

const newsConditionSchema = z.object({
  type: z.literal("news"),
  sentimentMin: z.number().optional(),
  sentimentMax: z.number().optional(),
  keywords: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
});

const transportConditionSchema = z.object({
  type: z.literal("transport"),
  commodity: z.string(),
  signalDirection: z.enum(["bullish", "bearish"]).optional(),
  minStrength: z.number().optional(),
});

const conditionSchema = z.discriminatedUnion("type", [
  indicatorConditionSchema,
  priceConditionSchema,
  newsConditionSchema,
  transportConditionSchema,
]);

const ruleSchema = z.object({
  id: z.string(),
  name: z.string(),
  conditions: z.array(conditionSchema),
  conditionLogic: z.enum(["AND", "OR"]),
  action: z.enum(["long", "short", "close_long", "close_short", "close_all"]),
  priority: z.number(),
});

const strategyConfigSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  symbols: z.array(z.string()).min(1),
  timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
  entryRules: z.array(ruleSchema),
  exitRules: z.array(ruleSchema),
  positionSizePercent: z.number().min(0.1).max(100),
  maxPositions: z.number().min(1).max(100),
  defaultStopLossPercent: z.number().optional(),
  defaultTakeProfitPercent: z.number().optional(),
  trailingStopPercent: z.number().optional(),
  tradingHoursStart: z.string().optional(),
  tradingHoursEnd: z.string().optional(),
  tradingDays: z.array(z.number()).optional(),
});

// GET /api/strategy - get user's strategies
strategyRoutes.get("/", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const strategies = await strategyService.getByUser(user.id);
  return c.json({ strategies });
});

// GET /api/strategy/public - get public strategies
strategyRoutes.get("/public", async (c) => {
  const strategies = await strategyService.getPublic(20);
  return c.json({ strategies });
});

// GET /api/strategy/:id - get strategy by ID
strategyRoutes.get("/:id", async (c) => {
  const user = await getUser(c);
  const strategyId = c.req.param("id");

  const strat = await strategyService.getById(strategyId);

  if (!strat) {
    return c.json({ error: "Strategy not found" }, 404);
  }

  // Check access
  if (!strat.isPublic && (!user || strat.userId !== user.id)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(strat);
});

// POST /api/strategy - create new strategy
strategyRoutes.post(
  "/",
  zValidator("json", strategyConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const config = c.req.valid("json") as StrategyConfig;

    try {
      const created = await strategyService.create(user.id, config);
      return c.json({ success: true, strategy: created });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Creation failed" },
        400
      );
    }
  }
);

// PUT /api/strategy/:id - update strategy
strategyRoutes.put(
  "/:id",
  zValidator("json", strategyConfigSchema.partial()),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const strategyId = c.req.param("id");
    const updates = c.req.valid("json");

    try {
      const updated = await strategyService.update(
        strategyId,
        user.id,
        updates
      );
      return c.json({ success: true, strategy: updated });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Update failed" },
        400
      );
    }
  }
);

// DELETE /api/strategy/:id - delete strategy
strategyRoutes.delete("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const strategyId = c.req.param("id");

  try {
    await strategyService.delete(strategyId, user.id);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      400
    );
  }
});

// POST /api/strategy/:id/toggle - toggle active status
strategyRoutes.post("/:id/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const strategyId = c.req.param("id");

  try {
    const isActive = await strategyService.toggleActive(strategyId, user.id);
    return c.json({ success: true, isActive });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Toggle failed" },
      400
    );
  }
});

// GET /api/strategy/:id/code - get generated Lean code
strategyRoutes.get("/:id/code", async (c) => {
  const user = await getUser(c);
  const strategyId = c.req.param("id");

  const strat = await strategyService.getById(strategyId);

  if (!strat) {
    return c.json({ error: "Strategy not found" }, 404);
  }

  // Check access
  if (!strat.isPublic && (!user || strat.userId !== user.id)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json({
    code: strat.leanCode,
    name: strat.name,
    language: "python",
  });
});

// POST /api/strategy/generate-code - generate code without saving
strategyRoutes.post(
  "/generate-code",
  zValidator("json", strategyConfigSchema),
  async (c) => {
    const config = c.req.valid("json") as StrategyConfig;

    try {
      const code = strategyService.generateLeanCode(config);
      return c.json({ code, language: "python" });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Generation failed" },
        400
      );
    }
  }
);

export default strategyRoutes;
