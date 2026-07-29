import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import type { StrategyConfig } from "@trader/db";
import { Hono } from "hono";
import { z } from "zod";
import { autoTradingService } from "../services/auto-trading";
import {
  strategyRunnerService,
  strategyScheduler,
  strategyService,
} from "../services/strategy";

const strategyRoutes = new Hono();

async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

const strategyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  execution: z
    .object({
      roundTurnCostBps: z.number().min(0).max(100).optional(),
      maxGrossLeverage: z.number().min(0.1).max(5).optional(),
    })
    .optional(),
  wif: z.object({ enabled: z.boolean().optional() }).optional(),
  dot: z.object({ enabled: z.boolean().optional() }).optional(),
  risk: z
    .object({
      baseWifRiskPercent: z.number().positive().max(20).optional(),
      baseDotRiskPercent: z.number().positive().max(20).optional(),
      boostWifRiskPercent: z.number().positive().max(20).optional(),
      boostDotRiskPercent: z.number().positive().max(20).optional(),
      boostTriggerProfitPercent: z.number().positive().max(100).optional(),
      deRiskDrawdownPercent: z.number().positive().max(49).optional(),
      hardStopDrawdownPercent: z.number().positive().max(50).optional(),
    })
    .optional(),
});

async function safeResetContext(userId: string) {
  const execution = await autoTradingService.getConfig(userId);
  if (execution?.enabled) {
    throw new Error("Disable execution first");
  }
  const [canonical, context] = await Promise.all([
    strategyService.ensureCanonical(userId),
    autoTradingService.getExecutionContext(userId),
  ]);
  if (context.openPositions.length > 0) {
    throw new Error("Close all Binance positions first");
  }
  return { canonical, context };
}

strategyRoutes.get("/default", (c) =>
  c.json({ config: strategyService.getDefaultConfig() })
);

strategyRoutes.get("/status", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ scheduler: strategyScheduler.status() });
});

strategyRoutes.get("/canonical", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(await strategyService.ensureCanonical(user.id));
});

strategyRoutes.post(
  "/scan",
  zValidator(
    "json",
    z.object({ execute: z.boolean().default(false) }).default({ execute: false })
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

strategyRoutes.post("/runtime/reset", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { canonical, context } = await safeResetContext(user.id);
    return c.json({
      success: true,
      strategy: await strategyService.resetRuntime(
        canonical.id,
        user.id,
        context.equity
      ),
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Reset failed" },
      400
    );
  }
});

strategyRoutes.post("/validation/start", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  try {
    const { canonical, context } = await safeResetContext(user.id);
    return c.json({
      success: true,
      strategy: await strategyService.startForwardValidation(
        canonical.id,
        user.id,
        context.equity
      ),
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Forward validation failed",
      },
      400
    );
  }
});

strategyRoutes.get("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const found = await strategyService.getById(c.req.param("id"));
  if (!found || found.userId !== user.id) {
    return c.json({ error: "Strategy not found" }, 404);
  }
  return c.json(found);
});

strategyRoutes.put(
  "/:id",
  zValidator("json", strategyUpdateSchema),
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
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const found = await strategyService.getById(c.req.param("id"));
  if (!found || found.userId !== user.id) {
    return c.json({ error: "Strategy not found" }, 404);
  }
  return c.json({ code: found.leanCode, name: found.name, language: "python" });
});

export default strategyRoutes;
