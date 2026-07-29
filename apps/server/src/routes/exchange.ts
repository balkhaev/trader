import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { autoTradingConfig, db, exchangeAccount } from "@trader/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { decrypt, encrypt } from "../services/crypto.service";
import { createExchangeService } from "../services/exchange";

const exchange = new Hono();
const STRATEGY_SYMBOLS = new Set(["WIFUSDT", "DOTUSDT"]);

async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

async function ownedBinanceAccount(userId: string, id: string) {
  const [account] = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(
        eq(exchangeAccount.id, id),
        eq(exchangeAccount.userId, userId),
        eq(exchangeAccount.exchange, "binance")
      )
    );
  return account ?? null;
}

function serviceFor(account: NonNullable<Awaited<ReturnType<typeof ownedBinanceAccount>>>) {
  return createExchangeService("binance", {
    apiKey: decrypt(account.apiKey),
    apiSecret: decrypt(account.apiSecret),
    testnet: account.testnet,
  });
}

exchange.get("/accounts", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  return c.json(
    await db
      .select({
        id: exchangeAccount.id,
        exchange: exchangeAccount.exchange,
        name: exchangeAccount.name,
        testnet: exchangeAccount.testnet,
        enabled: exchangeAccount.enabled,
        createdAt: exchangeAccount.createdAt,
      })
      .from(exchangeAccount)
      .where(
        and(
          eq(exchangeAccount.userId, user.id),
          eq(exchangeAccount.exchange, "binance")
        )
      )
  );
});

exchange.post(
  "/accounts",
  zValidator(
    "json",
    z.object({
      exchange: z.literal("binance"),
      name: z.string().trim().min(1).max(80),
      apiKey: z.string().trim().min(1),
      apiSecret: z.string().trim().min(1),
      testnet: z.boolean().default(true),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const data = c.req.valid("json");
    if (!data.testnet && process.env.ALLOW_LIVE_TRADING !== "true") {
      return c.json(
        { error: "Live Binance accounts are locked; use testnet first" },
        400
      );
    }
    try {
      const service = createExchangeService("binance", data);
      const preflight = await service.getPreflight?.();
      if (!preflight?.canTrade || !preflight.oneWayMode) {
        return c.json(
          {
            error: "Binance futures preflight failed",
            details: preflight?.messages.join("; ") ?? "Unknown preflight error",
          },
          400
        );
      }
    } catch (error) {
      return c.json(
        {
          error: "Invalid Binance USD-M credentials",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        400
      );
    }
    const [account] = await db
      .insert(exchangeAccount)
      .values({
        userId: user.id,
        exchange: "binance",
        name: data.name,
        apiKey: encrypt(data.apiKey),
        apiSecret: encrypt(data.apiSecret),
        testnet: data.testnet,
      })
      .returning({
        id: exchangeAccount.id,
        exchange: exchangeAccount.exchange,
        name: exchangeAccount.name,
        testnet: exchangeAccount.testnet,
        enabled: exchangeAccount.enabled,
        createdAt: exchangeAccount.createdAt,
      });
    return c.json(account, 201);
  }
);

exchange.delete("/accounts/:id", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  const [inUse] = await db
    .select({ enabled: autoTradingConfig.enabled })
    .from(autoTradingConfig)
    .where(
      and(
        eq(autoTradingConfig.userId, user.id),
        eq(autoTradingConfig.exchangeAccountId, id)
      )
    );
  if (inUse?.enabled) {
    return c.json({ error: "Disable execution before deleting this account" }, 400);
  }
  const deleted = await db
    .delete(exchangeAccount)
    .where(
      and(
        eq(exchangeAccount.id, id),
        eq(exchangeAccount.userId, user.id),
        eq(exchangeAccount.exchange, "binance")
      )
    )
    .returning({ id: exchangeAccount.id });
  return deleted.length
    ? c.json({ success: true })
    : c.json({ error: "Binance account not found" }, 404);
});

exchange.get("/accounts/:id/balance", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const account = await ownedBinanceAccount(user.id, c.req.param("id"));
  if (!account) return c.json({ error: "Binance account not found" }, 404);
  try {
    const service = serviceFor(account);
    const [accountInfo, balances, preflight] = await Promise.all([
      service.getAccountInfo(),
      service.getBalances(),
      service.getPreflight?.(),
    ]);
    return c.json({ accountInfo, balances, preflight });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Balance request failed" },
      400
    );
  }
});

exchange.get("/accounts/:id/positions", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const account = await ownedBinanceAccount(user.id, c.req.param("id"));
  if (!account) return c.json({ error: "Binance account not found" }, 404);
  return c.json(await serviceFor(account).getPositions());
});

exchange.get("/accounts/:id/orders", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const account = await ownedBinanceAccount(user.id, c.req.param("id"));
  if (!account) return c.json({ error: "Binance account not found" }, 404);
  return c.json(await serviceFor(account).getOpenOrders());
});

exchange.post(
  "/accounts/:id/positions/:symbol/close",
  zValidator("json", z.object({}).default({})),
  async (c) => {
    const user = await getUser(c);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const symbol = c.req.param("symbol").toUpperCase();
    if (!STRATEGY_SYMBOLS.has(symbol)) {
      return c.json({ error: "Only WIFUSDT and DOTUSDT may be closed here" }, 400);
    }
    const [execution] = await db
      .select({ enabled: autoTradingConfig.enabled })
      .from(autoTradingConfig)
      .where(eq(autoTradingConfig.userId, user.id));
    if (execution?.enabled) {
      return c.json({ error: "Use Emergency Stop while execution is enabled" }, 400);
    }
    const account = await ownedBinanceAccount(user.id, c.req.param("id"));
    if (!account?.enabled) return c.json({ error: "Binance account unavailable" }, 404);
    const service = serviceFor(account);
    const position = (await service.getPositions()).find(
      (item) => item.symbol === symbol
    );
    if (!position) return c.json({ error: "Position not found" }, 404);
    const order = await service.createOrder({
      symbol,
      side: position.side === "long" ? "sell" : "buy",
      type: "market",
      quantity: position.quantity,
      reduceOnly: true,
    });
    await service.cancelAllOrders?.(symbol).catch(() => undefined);
    return c.json(order, 201);
  }
);

exchange.get("/overview", async (c) => {
  const user = await getUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  const accounts = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(
        eq(exchangeAccount.userId, user.id),
        eq(exchangeAccount.exchange, "binance"),
        eq(exchangeAccount.enabled, true)
      )
    );
  const settled = await Promise.allSettled(
    accounts.map(async (account) => {
      const service = serviceFor(account);
      const [accountInfo, positions] = await Promise.all([
        service.getAccountInfo(),
        service.getPositions(),
      ]);
      return {
        accountId: account.id,
        accountName: account.name,
        exchange: "binance" as const,
        testnet: account.testnet,
        ...accountInfo,
        positionsCount: positions.length,
        positions,
      };
    })
  );
  const overview = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []
  );
  const totalBalance = overview.reduce(
    (sum, account) => sum + Number(account.totalBalance || 0),
    0
  );
  const totalUnrealizedPnl = overview.reduce(
    (sum, account) => sum + Number(account.unrealizedPnl || 0),
    0
  );
  return c.json({
    totalBalance: String(totalBalance),
    totalUnrealizedPnl: String(totalUnrealizedPnl),
    totalPositions: overview.reduce(
      (sum, account) => sum + account.positionsCount,
      0
    ),
    accountsCount: overview.length,
    accounts: overview,
  });
});

export default exchange;
