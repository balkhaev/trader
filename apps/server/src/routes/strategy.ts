import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import type { StrategyConfig } from "@trader/db";
import { Hono } from "hono";
import { z } from "zod";
import { strategyRunnerService, strategyService } from "../services/strategy";

const strategyRoutes = new Hono();

async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

const weekdaySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

const strategyConfigSchema = z.object({
  kind: z.literal("consensus_wif_dot_v1"),
  name: z.string().min(1),
  description: z.string().optional(),
  timeframe: z.literal("15m"),
  execution: z.object({
    venue: z.literal("binance_usdm"),
    orderType: z.enum(["market", "limit"]),
    roundTurnCostBps: z.number().min(0).max(200),
    maxPositions: z.number().int().min(1).max(2),
    maxGrossLeverage: z.number().min(0.1).max(5),
    skipOvernight: z.boolean(),
    skipFundingCrossing: z.boolean(),
  }),
  wif: z.object({
    enabled: z.boolean(),
    symbol: z.literal("WIFUSDT"),
    allowedWeekdaysUtc: z.array(weekdaySchema),
    move45mAtrMax: z.number().max(0),
    volumeZMin: z.number(),
    lowerWickRatioMin: z.number().min(0).max(1),
    closeLocationMin: z.number().min(0).max(1),
    takerImbalanceMin: z.number().min(-1).max(1),
    oiZMax: z.number(),
    strengthMin: z.number().min(0),
    stopAtr: z.number().positive(),
    targetR: z.number().positive(),
    maxHoldMinutes: z.number().int().positive(),
  }),
  dot: z.object({
    enabled: z.boolean(),
    symbol: z.literal("DOTUSDT"),
    entryDelayMinutes: z.number().int().min(0).max(60),
    weekdayFundingThresholdBps: z.record(z.string(), z.number()),
    stopAtr: z.number().positive(),
    targetR: z.number().positive(),
    maxHoldMinutes: z.number().int().positive(),
  }),
  risk: z.object({
    baseWifRiskPercent: z.number().positive().max(20),
    baseDotRiskPercent: z.number().positive().max(20),
    boostWifRiskPercent: z.number().positive().max(20),
    boostDotRiskPercent: z.number().positive().max(20),
    boostTriggerProfitPercent: z.number().positive().max(100),
    deRiskDrawdownPercent: z.number().positive().max(50),
    hardStopDrawdownPercent: z.number().positive().max(50),
  }),
});

strategyRoutes.get("/default", (c) =>
  c.json({ config: strategyService.getDefaultConfig() })
);

strategyRoutes.get("/canonical", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const canonical = await strategyService.ensureCanonical(user.id);
  return c.json(canonical);
});

strategyRoutes.post(
  "/scan",
  zValidator(
    "json",
    z
      .object({ execute: z.boolean().default(false) })
      .default({ execute: false })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    try {
      return c.json(
        await strategyRunnerService.scanUser(user.id, c.req.valid("json"))
      );
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Scan failed" },
        400
      );
    }
  }
);

strategyRoutes.get("/", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ strategies: await strategyService.getByUser(user.id) });
});

strategyRoutes.get("/public", async (c) =>
  c.json({ strategies: await strategyService.getPublic(20) })
);

strategyRoutes.post(
  "/",
  zValidator("json", strategyConfigSchema),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    try {
      const created = await strategyService.create(
        user.id,
        c.req.valid("json") as StrategyConfig
      );
      return c.json({ success: true, strategy: created });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Creation failed" },
        400
      );
    }
  }
);

strategyRoutes.post(
  "/generate-code",
  zValidator("json", strategyConfigSchema),
  (c) => {
    const config = c.req.valid("json") as StrategyConfig;
    return c.json({
      code: strategyService.generateLeanCode(config),
      language: "python",
    });
  }
);

strategyRoutes.get("/:id", async (c) => {
  const user = await getUser(c);
  const found = await strategyService.getById(c.req.param("id"));
  if (!found) return c.json({ error: "Strategy not found" }, 404);
  if (!found.isPublic && (!user || found.userId !== user.id)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json(found);
});

strategyRoutes.put(
  "/:id",
  zValidator("json", strategyConfigSchema.partial()),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    try {
      const updated = await strategyService.update(
        c.req.param("id"),
        user.id,
        c.req.valid("json") as Partial<StrategyConfig>
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

strategyRoutes.delete("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  await strategyService.delete(c.req.param("id"), user.id);
  return c.json({ success: true });
});

strategyRoutes.post("/:id/toggle", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    const isActive = await strategyService.toggleActive(
      c.req.param("id"),
      user.id
    );
    return c.json({ success: true, isActive });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Toggle failed" },
      400
    );
  }
});

strategyRoutes.get("/:id/code", async (c) => {
  const user = await getUser(c);
  const found = await strategyService.getById(c.req.param("id"));
  if (!found) return c.json({ error: "Strategy not found" }, 404);
  if (!found.isPublic && (!user || found.userId !== user.id)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  return c.json({ code: found.leanCode, name: found.name, language: "python" });
});

export default strategyRoutes;
