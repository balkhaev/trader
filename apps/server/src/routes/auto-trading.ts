import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { Hono } from "hono";
import { z } from "zod";
import { autoTradingService } from "../services/auto-trading";
import { strategyService } from "../services/strategy/strategy.service";

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
  z.string().refine((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum;
  }, `Value must be between ${minimum} and ${maximum}`);

const updateConfigSchema = z.object({
  exchangeAccountId: z.string().uuid().nullable().optional(),
  maxPositionSize: numericString(0, 10_000_000).optional(),
  maxDailyTrades: numericString(1, 20).optional(),
  maxOpenPositions: z.enum(["1", "2"]).optional(),
});

const startSchema = z.object({
  mode: z.enum(["paper", "exchange"]),
  exchangeAccountId: z.string().uuid().optional(),
});

async function startTrading(
  userId: string,
  input: z.infer<typeof startSchema>
) {
  if (input.mode === "exchange" && !input.exchangeAccountId) {
    throw new Error("Choose a Binance account");
  }
  const current = await autoTradingService.getConfig(userId);
  const currentMode = current?.exchangeAccountId ? "exchange" : "paper";
  if (current?.enabled && currentMode !== input.mode) {
    throw new Error("Stop the current trading mode first");
  }
  let canonical = await strategyService.ensureCanonical(userId);
  if (!canonical.isActive) {
    await strategyService.toggleActive(canonical.id, userId);
    canonical = (await strategyService.getById(canonical.id)) ?? canonical;
  }
  const paperRuntimeNeedsReset =
    input.mode === "paper" &&
    (currentMode === "exchange" ||
      canonical.config.runtime?.mode === "stopped");
  if (paperRuntimeNeedsReset) {
    await strategyService.resetRuntime(canonical.id, userId, 10_000);
  }
  await autoTradingService.upsertConfig(userId, {
    enabled: false,
    exchangeAccountId: input.mode === "paper" ? null : input.exchangeAccountId,
  });
  const preflight = await autoTradingService.getPreflight(userId);
  if (!preflight.ready) {
    throw new Error(preflight.reasons[0] ?? "Execution preflight failed");
  }
  const config = await autoTradingService.upsertConfig(userId, {
    enabled: true,
  });
  return { config, preflight };
}

autoTrading.get("/config", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json((await autoTradingService.getConfig(user.id)) ?? EMPTY_CONFIG);
});

autoTrading.get("/preflight", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json(await autoTradingService.getPreflight(user.id));
});

autoTrading.put(
  "/config",
  zValidator("json", updateConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const config = await autoTradingService.upsertConfig(
      user.id,
      c.req.valid("json")
    );
    return c.json({ success: true, config });
  }
);

autoTrading.post("/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
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

autoTrading.post("/start", zValidator("json", startSchema), async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const input = c.req.valid("json");
    const result = await startTrading(user.id, input);
    return c.json({ success: true, mode: input.mode, ...result });
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Trading start failed",
      },
      400
    );
  }
});

autoTrading.post("/stop", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const config = await autoTradingService.upsertConfig(user.id, {
    enabled: false,
  });
  return c.json({ success: true, enabled: config.enabled });
});

autoTrading.post("/emergency-stop", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
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
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }
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
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }
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
