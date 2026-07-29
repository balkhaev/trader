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

const EMPTY_CONFIG = {
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

const numericString = (minimum: number, maximum: number) =>
  z
    .string()
    .refine((value) => {
      const number = Number(value);
      return Number.isFinite(number) && number >= minimum && number <= maximum;
    }, `Value must be between ${minimum} and ${maximum}`);

const updateConfigSchema = z.object({
  exchangeAccountId: z.string().uuid().nullable().optional(),
  maxPositionSize: numericString(0, 10_000_000).optional(),
  maxDailyTrades: numericString(1, 20).optional(),
  maxOpenPositions: z.enum(["1", "2"]).optional(),
});

autoTrading.get("/config", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json((await autoTradingService.getConfig(user.id)) ?? EMPTY_CONFIG);
});

autoTrading.get("/preflight", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await autoTradingService.getPreflight(user.id));
});

autoTrading.put(
  "/config",
  zValidator("json", updateConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const config = await autoTradingService.upsertConfig(
      user.id,
      c.req.valid("json")
    );
    return c.json({ success: true, config });
  }
);

autoTrading.post("/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const current = await autoTradingService.getConfig(user.id);
  const enabling = !(current?.enabled ?? false);
  if (enabling) {
    const preflight = await autoTradingService.getPreflight(user.id);
    if (!preflight.ready) {
      return c.json({ error: "Execution preflight failed", preflight }, 400);
    }
  }
  const updated = await autoTradingService.upsertConfig(user.id, {
    enabled: enabling,
  });
  return c.json({ success: true, enabled: updated.enabled });
});

autoTrading.post("/emergency-stop", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    return c.json({
      success: true,
      ...(await autoTradingService.emergencyStop(user.id)),
    });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Emergency stop failed",
      },
      400
    );
  }
});

autoTrading.get(
  "/logs",
  zValidator(
    "query",
    z.object({ limit: z.coerce.number().int().min(1).max(100).optional() })
  ),
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
