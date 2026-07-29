import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { db, signal } from "@trader/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

const signals = new Hono();
const strategySignal = sql`${signal.metadata}->>'strategyKind' = 'consensus_wif_dot_v1'`;

async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

const paging = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

signals.get(
  "/",
  zValidator(
    "query",
    paging.extend({
      status: z.enum(["pending", "executed", "rejected", "expired"]).optional(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const query = c.req.valid("query");
    const conditions = [eq(signal.userId, user.id), strategySignal];
    if (query.status) conditions.push(eq(signal.status, query.status));
    return c.json(
      await db
        .select()
        .from(signal)
        .where(and(...conditions))
        .orderBy(desc(signal.createdAt))
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0)
    );
  }
);

signals.get("/pending", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(
    await db
      .select()
      .from(signal)
      .where(
        and(
          eq(signal.userId, user.id),
          eq(signal.status, "pending"),
          strategySignal
        )
      )
      .orderBy(desc(signal.createdAt))
  );
});

signals.get("/closed", zValidator("query", paging), async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const query = c.req.valid("query");
  return c.json(
    await db
      .select()
      .from(signal)
      .where(
        and(
          eq(signal.userId, user.id),
          eq(signal.status, "executed"),
          isNotNull(signal.exitPrice),
          strategySignal
        )
      )
      .orderBy(desc(signal.exitAt))
      .limit(query.limit ?? 50)
      .offset(query.offset ?? 0)
  );
});

async function closedForUser(userId: string) {
  return db
    .select()
    .from(signal)
    .where(
      and(
        eq(signal.userId, userId),
        eq(signal.status, "executed"),
        isNotNull(signal.exitPrice),
        strategySignal
      )
    );
}

signals.get("/stats", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const rows = await db
    .select({ status: signal.status })
    .from(signal)
    .where(and(eq(signal.userId, user.id), strategySignal));
  const count = (status: (typeof rows)[number]["status"]) =>
    rows.filter((row) => row.status === status).length;
  const executed = count("executed");
  return c.json({
    total: rows.length,
    pending: count("pending"),
    executed,
    rejected: count("rejected"),
    expired: count("expired"),
    executionRate: rows.length > 0 ? executed / rows.length : 0,
  });
});

signals.get("/performance", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const rows = await closedForUser(user.id);
  const returns = rows.map((row) => Number(row.realizedPnl ?? 0));
  const wins = rows.filter((row) => row.isWin === true);
  const losses = rows.filter((row) => row.isWin === false);
  const totalReturn = returns.reduce((sum, value) => sum + value, 0);
  const avgReturn = returns.length ? totalReturn / returns.length : 0;
  const ordered = [...rows].sort(
    (left, right) => Number(right.realizedPnl ?? 0) - Number(left.realizedPnl ?? 0)
  );
  const holding = rows
    .map((row) => Number(row.holdingPeriodMinutes ?? 0))
    .filter((value) => value > 0);
  const variance = returns.length
    ? returns.reduce((sum, value) => sum + (value - avgReturn) ** 2, 0) /
      returns.length
    : 0;
  const deviation = Math.sqrt(variance);
  const trade = (row: (typeof rows)[number] | undefined) =>
    row
      ? {
          id: row.id,
          symbol: row.symbol,
          side: row.side,
          pnl: Number(row.realizedPnl ?? 0),
        }
      : null;
  return c.json({
    totalClosed: rows.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: rows.length ? wins.length / rows.length : 0,
    avgReturn,
    totalReturn,
    bestTrade: trade(ordered.at(0)),
    worstTrade: trade(ordered.at(-1)),
    avgHoldingPeriodMinutes: holding.length
      ? holding.reduce((sum, value) => sum + value, 0) / holding.length
      : 0,
    sharpeRatio:
      deviation > 0 && returns.length >= 2
        ? (avgReturn / deviation) * Math.sqrt(returns.length)
        : null,
  });
});

signals.get("/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const [found] = await db
    .select()
    .from(signal)
    .where(
      and(
        eq(signal.id, c.req.param("id")),
        eq(signal.userId, user.id),
        strategySignal
      )
    );
  return found
    ? c.json({ ...found, analyses: [] })
    : c.json({ error: "Strategy signal not found" }, 404);
});

export default signals;
