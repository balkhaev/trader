import { zValidator } from "@hono/zod-validator";
import { auth } from "@trader/auth";
import { db, exchangeAccount } from "@trader/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { decrypt, encrypt } from "../services/crypto.service";
import { createExchangeService } from "../services/exchange";

const exchange = new Hono();

// Middleware для получения пользователя
async function getUser(c: { req: { raw: Request } }) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user;
}

// GET /api/exchange/accounts - список аккаунтов
exchange.get("/accounts", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const accounts = await db
    .select({
      id: exchangeAccount.id,
      exchange: exchangeAccount.exchange,
      name: exchangeAccount.name,
      testnet: exchangeAccount.testnet,
      enabled: exchangeAccount.enabled,
      createdAt: exchangeAccount.createdAt,
    })
    .from(exchangeAccount)
    .where(eq(exchangeAccount.userId, user.id));

  return c.json(accounts);
});

// POST /api/exchange/accounts - добавить аккаунт
exchange.post(
  "/accounts",
  zValidator(
    "json",
    z.object({
      exchange: z.enum(["bybit", "binance", "tinkoff"]),
      name: z.string().min(1),
      apiKey: z.string().min(1),
      apiSecret: z.string().min(1),
      testnet: z.boolean().default(false),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const data = c.req.valid("json");

    // Проверяем валидность ключей, пытаясь получить баланс
    try {
      const service = createExchangeService(data.exchange, {
        apiKey: data.apiKey,
        apiSecret: data.apiSecret,
        testnet: data.testnet,
      });
      await service.getAccountInfo();
    } catch (error) {
      return c.json(
        {
          error: "Invalid API credentials",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        400
      );
    }

    // Шифруем ключи
    const encryptedApiKey = encrypt(data.apiKey);
    const encryptedApiSecret = encrypt(data.apiSecret);

    const [account] = await db
      .insert(exchangeAccount)
      .values({
        userId: user.id,
        exchange: data.exchange,
        name: data.name,
        apiKey: encryptedApiKey,
        apiSecret: encryptedApiSecret,
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

// DELETE /api/exchange/accounts/:id - удалить аккаунт
exchange.delete("/accounts/:id", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const result = await db
    .delete(exchangeAccount)
    .where(and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id)))
    .returning({ id: exchangeAccount.id });

  if (result.length === 0) {
    return c.json({ error: "Account not found" }, 404);
  }

  return c.json({ success: true });
});

// GET /api/exchange/accounts/:id/balance - баланс аккаунта
exchange.get("/accounts/:id/balance", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const [account] = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
    );

  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  try {
    const service = createExchangeService(account.exchange, {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });

    const [accountInfo, balances] = await Promise.all([
      service.getAccountInfo(),
      service.getBalances(),
    ]);

    return c.json({ accountInfo, balances });
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch balance",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// GET /api/exchange/accounts/:id/positions - позиции аккаунта
exchange.get("/accounts/:id/positions", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const [account] = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
    );

  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  try {
    const service = createExchangeService(account.exchange, {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });

    const positions = await service.getPositions();
    return c.json(positions);
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch positions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// GET /api/exchange/accounts/:id/orders - открытые ордера
exchange.get("/accounts/:id/orders", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const [account] = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
    );

  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  try {
    const service = createExchangeService(account.exchange, {
      apiKey: decrypt(account.apiKey),
      apiSecret: decrypt(account.apiSecret),
      testnet: account.testnet,
    });

    const orders = await service.getOpenOrders();
    return c.json(orders);
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch orders",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// POST /api/exchange/accounts/:id/orders - создать ордер
exchange.post(
  "/accounts/:id/orders",
  zValidator(
    "json",
    z.object({
      symbol: z.string(),
      side: z.enum(["buy", "sell"]),
      type: z.enum(["market", "limit"]),
      quantity: z.string(),
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

    const id = c.req.param("id");
    const orderParams = c.req.valid("json");

    const [account] = await db
      .select()
      .from(exchangeAccount)
      .where(
        and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
      );

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    if (!account.enabled) {
      return c.json({ error: "Account is disabled" }, 400);
    }

    try {
      const service = createExchangeService(account.exchange, {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });

      const order = await service.createOrder(orderParams);
      return c.json(order, 201);
    } catch (error) {
      return c.json(
        {
          error: "Failed to create order",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }
);

// DELETE /api/exchange/accounts/:id/orders/:orderId - отменить ордер
exchange.delete(
  "/accounts/:id/orders/:orderId",
  zValidator(
    "json",
    z.object({
      symbol: z.string(),
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param("id");
    const orderId = c.req.param("orderId");
    const { symbol } = c.req.valid("json");

    const [account] = await db
      .select()
      .from(exchangeAccount)
      .where(
        and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
      );

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    try {
      const service = createExchangeService(account.exchange, {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });

      await service.cancelOrder(orderId, symbol);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          error: "Failed to cancel order",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }
);

// POST /api/exchange/accounts/:id/positions/:symbol/close - закрыть позицию
exchange.post(
  "/accounts/:id/positions/:symbol/close",
  zValidator(
    "json",
    z.object({
      quantity: z.string().optional(), // Если не указано - закрыть полностью
      type: z.enum(["market", "limit"]).default("market"),
      price: z.string().optional(), // Только для limit
    })
  ),
  async (c) => {
    const user = await getUser(c);
    if (!user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const id = c.req.param("id");
    const symbol = c.req.param("symbol");
    const { quantity, type, price } = c.req.valid("json");

    const [account] = await db
      .select()
      .from(exchangeAccount)
      .where(
        and(eq(exchangeAccount.id, id), eq(exchangeAccount.userId, user.id))
      );

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    if (!account.enabled) {
      return c.json({ error: "Account is disabled" }, 400);
    }

    try {
      const service = createExchangeService(account.exchange, {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });

      // Получаем текущую позицию
      const positions = await service.getPositions();
      const position = positions.find((p) => p.symbol === symbol);

      if (!position) {
        return c.json({ error: "Position not found" }, 404);
      }

      // Закрываем позицию противоположным ордером
      const closeQty = quantity || position.quantity;
      const closeSide = position.side === "long" ? "sell" : "buy";

      const order = await service.createOrder({
        symbol,
        side: closeSide,
        type,
        quantity: closeQty,
        price: type === "limit" ? price : undefined,
      });

      return c.json(order, 201);
    } catch (error) {
      return c.json(
        {
          error: "Failed to close position",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        500
      );
    }
  }
);

// GET /api/exchange/overview - агрегированный обзор всех аккаунтов
exchange.get("/overview", async (c) => {
  const user = await getUser(c);
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const accounts = await db
    .select()
    .from(exchangeAccount)
    .where(
      and(
        eq(exchangeAccount.userId, user.id),
        eq(exchangeAccount.enabled, true)
      )
    );

  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      const service = createExchangeService(account.exchange, {
        apiKey: decrypt(account.apiKey),
        apiSecret: decrypt(account.apiSecret),
        testnet: account.testnet,
      });

      const [accountInfo, positions] = await Promise.all([
        service.getAccountInfo(),
        service.getPositions(),
      ]);

      return {
        accountId: account.id,
        accountName: account.name,
        exchange: account.exchange,
        testnet: account.testnet,
        ...accountInfo,
        positionsCount: positions.length,
        positions,
      };
    })
  );

  const overview = results
    .filter((r) => r.status === "fulfilled")
    .map(
      (r) =>
        (
          r as PromiseFulfilledResult<{
            accountId: string;
            accountName: string;
            exchange: string;
            testnet: boolean;
            totalBalance: string;
            availableBalance: string;
            unrealizedPnl: string;
            marginUsed?: string;
            positionsCount: number;
            positions: Array<{
              symbol: string;
              side: "long" | "short";
              quantity: string;
              entryPrice: string;
              currentPrice: string;
              unrealizedPnl: string;
              leverage?: number;
              liquidationPrice?: string;
            }>;
          }>
        ).value
    );

  const totalBalance = overview.reduce(
    (sum, acc) => sum + Number.parseFloat(acc.totalBalance || "0"),
    0
  );

  const totalUnrealizedPnl = overview.reduce(
    (sum, acc) => sum + Number.parseFloat(acc.unrealizedPnl || "0"),
    0
  );

  const totalPositions = overview.reduce(
    (sum, acc) => sum + acc.positionsCount,
    0
  );

  return c.json({
    totalBalance: totalBalance.toString(),
    totalUnrealizedPnl: totalUnrealizedPnl.toString(),
    totalPositions,
    accountsCount: overview.length,
    accounts: overview,
  });
});

export default exchange;
