import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { Hono } from "hono";
import { z } from "zod";
import { signalService } from "../services/signals";

const signals = new Hono();

// Хелпер для получения пользователя
async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

// GET /api/signals - все сигналы пользователя
signals.get(
  "/",
  zValidator(
    "query",
    z.object({
      status: z.enum(["pending", "executed", "rejected", "expired"]).optional(),
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const params = c.req.valid("query");
    const signalsList = await signalService.getAll(user.id, params);
    return c.json(signalsList);
  }
);

// GET /api/signals/pending - pending сигналы
signals.get("/pending", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const pending = await signalService.getPending(user.id);
  return c.json(pending);
});

// GET /api/signals/stats - статистика сигналов
signals.get("/stats", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const stats = await signalService.getStats(user.id);
  return c.json(stats);
});

// GET /api/signals/performance - статистика производительности
signals.get("/performance", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const performance = await signalService.getPerformanceStats(user.id);
  return c.json(performance);
});

// GET /api/signals/closed - закрытые сигналы
signals.get(
  "/closed",
  zValidator(
    "query",
    z.object({
      limit: z.coerce.number().optional(),
      offset: z.coerce.number().optional(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const params = c.req.valid("query");
    const closedSignals = await signalService.getClosedSignals(user.id, params);
    return c.json(closedSignals);
  }
);

// GET /api/signals/:id - детали сигнала
signals.get("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const signalId = c.req.param("id");
  const signal = await signalService.getWithAnalyses(signalId);

  if (!signal) {
    return c.json({ error: "Signal not found" }, 404);
  }

  if (signal.userId !== user.id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(signal);
});

// POST /api/signals/:id/approve - подтвердить сигнал
signals.post(
  "/:id/approve",
  zValidator(
    "json",
    z.object({
      exchangeAccountId: z.string().uuid(),
      quantity: z.string().min(1),
      orderType: z.enum(["market", "limit"]),
      price: z.string().optional(),
      stopLoss: z.string().optional(),
      takeProfit: z.string().optional(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const signalId = c.req.param("id");
    const params = c.req.valid("json");

    try {
      const order = await signalService.approve(signalId, user.id, params);
      return c.json({ success: true, order });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Execution failed" },
        400
      );
    }
  }
);

// POST /api/signals/:id/reject - отклонить сигнал
signals.post(
  "/:id/reject",
  zValidator(
    "json",
    z
      .object({
        reason: z.string().optional(),
      })
      .optional()
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const signalId = c.req.param("id");
    const body = c.req.valid("json");

    try {
      await signalService.reject(signalId, user.id, body?.reason);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Rejection failed" },
        400
      );
    }
  }
);

// POST /api/signals/:id/close - закрыть сигнал с фиксацией P&L
signals.post(
  "/:id/close",
  zValidator(
    "json",
    z.object({
      exitPrice: z.string().min(1),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const signalId = c.req.param("id");
    const params = c.req.valid("json");

    try {
      const updatedSignal = await signalService.closeSignal(
        signalId,
        user.id,
        params
      );
      return c.json({ success: true, signal: updatedSignal });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Close failed" },
        400
      );
    }
  }
);

// PATCH /api/signals/:id/entry-price - установить цену входа
signals.patch(
  "/:id/entry-price",
  zValidator(
    "json",
    z.object({
      entryPrice: z.string().min(1),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const signalId = c.req.param("id");
    const { entryPrice } = c.req.valid("json");

    try {
      const updatedSignal = await signalService.updateEntryPrice(
        signalId,
        user.id,
        entryPrice
      );
      return c.json({ success: true, signal: updatedSignal });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Update failed" },
        400
      );
    }
  }
);

export default signals;
