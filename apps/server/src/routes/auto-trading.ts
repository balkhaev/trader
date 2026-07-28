import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { Hono } from "hono";
import { z } from "zod";
import { autoTradingService } from "../services/auto-trading";

const autoTrading = new Hono();

async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

const DEFAULT_CONFIG = {
  enabled: false,
  exchangeAccountId: null,
  minSignalStrength: "0",
  allowedSources: ["webhook"],
  allowedSymbols: ["WIFUSDT", "DOTUSDT"],
  blockedSymbols: null,
  allowLong: true,
  allowShort: false,
  positionSizeType: "risk_based",
  positionSizeValue: "1",
  maxPositionSize: "0",
  defaultStopLossPercent: "0",
  defaultTakeProfitPercent: "0",
  maxDailyTrades: "10",
  maxOpenPositions: "2",
  maxDailyLossPercent: "15",
  orderType: "market",
  useStopLoss: true,
  useTakeProfit: true,
};

autoTrading.get("/config", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(
    (await autoTradingService.getConfig(user.id)) ?? DEFAULT_CONFIG
  );
});

const updateConfigSchema = z.object({
  enabled: z.boolean().optional(),
  exchangeAccountId: z.string().nullable().optional(),
  maxPositionSize: z.string().optional(),
  maxDailyTrades: z.string().optional(),
  maxOpenPositions: z.string().optional(),
  maxDailyLossPercent: z.string().optional(),
  orderType: z.enum(["market", "limit"]).optional(),
});

autoTrading.put(
  "/config",
  zValidator("json", updateConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const config = await autoTradingService.upsertConfig(user.id, {
      ...DEFAULT_CONFIG,
      ...c.req.valid("json"),
    });
    return c.json({ success: true, config });
  }
);

autoTrading.post("/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const current = await autoTradingService.getConfig(user.id);
  const updated = await autoTradingService.upsertConfig(user.id, {
    ...DEFAULT_CONFIG,
    enabled: !(current?.enabled ?? false),
    exchangeAccountId: current?.exchangeAccountId ?? null,
  });
  return c.json({ success: true, enabled: updated.enabled });
});

autoTrading.get(
  "/logs",
  zValidator("query", z.object({ limit: z.coerce.number().optional() })),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    return c.json({
      logs: await autoTradingService.getLogs(
        user.id,
        c.req.valid("query").limit
      ),
    });
  }
);

autoTrading.get("/stats", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const [stats, config] = await Promise.all([
    autoTradingService.getStats(user.id),
    autoTradingService.getConfig(user.id),
  ]);
  return c.json({
    ...stats,
    enabled: config?.enabled ?? false,
    maxDailyTrades: config?.maxDailyTrades ?? "10",
  });
});

export default autoTrading;
