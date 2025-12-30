import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { Hono } from "hono";
import { z } from "zod";
import { autoTradingService } from "../services/auto-trading";

const autoTrading = new Hono();

// Helper to get user
async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

// GET /api/auto-trading/config - get user's config
autoTrading.get("/config", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const config = await autoTradingService.getConfig(user.id);

  if (!config) {
    // Return default config
    return c.json({
      enabled: false,
      exchangeAccountId: null,
      minSignalStrength: "75",
      allowedSources: ["llm"],
      allowedSymbols: null,
      blockedSymbols: null,
      allowLong: true,
      allowShort: true,
      positionSizeType: "fixed",
      positionSizeValue: "100",
      maxPositionSize: "1000",
      defaultStopLossPercent: "5",
      defaultTakeProfitPercent: "10",
      maxDailyTrades: "10",
      maxOpenPositions: "5",
      maxDailyLossPercent: "5",
      orderType: "market",
      useStopLoss: true,
      useTakeProfit: true,
    });
  }

  return c.json(config);
});

// PUT /api/auto-trading/config - update config
const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  exchangeAccountId: z.string().nullable().optional(),
  minSignalStrength: z.string().optional(),
  allowedSources: z.array(z.string()).optional(),
  allowedSymbols: z.array(z.string()).nullable().optional(),
  blockedSymbols: z.array(z.string()).nullable().optional(),
  allowLong: z.boolean().optional(),
  allowShort: z.boolean().optional(),
  positionSizeType: z.enum(["fixed", "percent", "risk_based"]).optional(),
  positionSizeValue: z.string().optional(),
  maxPositionSize: z.string().optional(),
  defaultStopLossPercent: z.string().optional(),
  defaultTakeProfitPercent: z.string().optional(),
  maxDailyTrades: z.string().optional(),
  maxOpenPositions: z.string().optional(),
  maxDailyLossPercent: z.string().optional(),
  orderType: z.enum(["market", "limit"]).optional(),
  useStopLoss: z.boolean().optional(),
  useTakeProfit: z.boolean().optional(),
});

autoTrading.put(
  "/config",
  zValidator("json", updateConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const updates = c.req.valid("json");
    const config = await autoTradingService.upsertConfig(user.id, updates);

    return c.json({ success: true, config });
  }
);

// POST /api/auto-trading/toggle - quickly enable/disable
autoTrading.post("/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const config = await autoTradingService.getConfig(user.id);
  const newEnabled = !config?.enabled;

  const updated = await autoTradingService.upsertConfig(user.id, {
    enabled: newEnabled,
  });

  return c.json({ success: true, enabled: updated.enabled });
});

// GET /api/auto-trading/logs - get execution logs
autoTrading.get(
  "/logs",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { limit } = c.req.valid("query");
    const logs = await autoTradingService.getLogs(user.id, limit);

    return c.json({ logs });
  }
);

// GET /api/auto-trading/stats - get today's stats
autoTrading.get("/stats", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const stats = await autoTradingService.getStats(user.id);
  const config = await autoTradingService.getConfig(user.id);

  return c.json({
    ...stats,
    enabled: config?.enabled ?? false,
    maxDailyTrades: config?.maxDailyTrades ?? "10",
  });
});

export default autoTrading;
