import { afterEach, describe, expect, test } from "bun:test";
import { BinanceExchangeService } from "./binance";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Binance USD-M strategy adapter", () => {
  test("requires trading permission and One-way Mode", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/fapi/v3/account")) {
        return json({
          canTrade: true,
          totalWalletBalance: "10000",
          availableBalance: "9000",
          totalUnrealizedProfit: "0",
          totalInitialMargin: "0",
        });
      }
      return json({ dualSidePosition: false });
    }) as unknown as typeof fetch;

    const service = new BinanceExchangeService({
      apiKey: "key",
      apiSecret: "secret",
      testnet: true,
    });
    const preflight = await service.getPreflight();
    expect(preflight.canTrade).toBe(true);
    expect(preflight.oneWayMode).toBe(true);
    expect(preflight.messages).toEqual([]);
    expect(calls.some((url) => url.includes("positionSide/dual"))).toBe(true);
  });

  test("places market entry, stop and take-profit protection", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    globalThis.fetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, method, body });
      if (url.includes("exchangeInfo")) {
        return json({
          symbols: [
            {
              symbol: "WIFUSDT",
              filters: [
                {
                  filterType: "MARKET_LOT_SIZE",
                  stepSize: "0.1",
                  minQty: "0.1",
                },
                { filterType: "PRICE_FILTER", tickSize: "0.0001" },
              ],
            },
          ],
        });
      }
      if (body.includes("type=MARKET")) {
        return json({
          orderId: 10,
          symbol: "WIFUSDT",
          side: "BUY",
          type: "MARKET",
          status: "FILLED",
          origQty: "10.0",
          executedQty: "10.0",
          avgPrice: "1.0000",
          price: "0",
          updateTime: Date.now(),
        });
      }
      return json({});
    }) as unknown as typeof fetch;

    const service = new BinanceExchangeService({
      apiKey: "key",
      apiSecret: "secret",
      testnet: true,
    });
    const order = await service.createOrder({
      symbol: "WIFUSDT",
      side: "buy",
      type: "market",
      quantity: "10.04",
      stopLoss: "0.9",
      takeProfit: "1.5",
    });

    expect(order.status).toBe("filled");
    const bodies = requests.map((request) => request.body);
    expect(bodies.some((body) => body.includes("type=MARKET"))).toBe(true);
    expect(bodies.some((body) => body.includes("type=STOP_MARKET"))).toBe(true);
    expect(
      bodies.some((body) => body.includes("type=TAKE_PROFIT_MARKET"))
    ).toBe(true);
    expect(
      bodies
        .filter(
          (body) =>
            body.includes("STOP_MARKET") ||
            body.includes("TAKE_PROFIT_MARKET")
        )
        .every((body) => body.includes("closePosition=true"))
    ).toBe(true);
  });

  test("rejects protected limit entries", async () => {
    globalThis.fetch = (async () =>
      json({
        symbols: [
          {
            symbol: "DOTUSDT",
            filters: [
              {
                filterType: "MARKET_LOT_SIZE",
                stepSize: "0.1",
                minQty: "0.1",
              },
              { filterType: "PRICE_FILTER", tickSize: "0.001" },
            ],
          },
        ],
      })) as unknown as typeof fetch;
    const service = new BinanceExchangeService({
      apiKey: "key",
      apiSecret: "secret",
      testnet: true,
    });
    expect(
      service.createOrder({
        symbol: "DOTUSDT",
        side: "buy",
        type: "limit",
        quantity: "1",
        price: "4",
        stopLoss: "3.5",
      })
    ).rejects.toThrow("Protected strategy entries must use market orders");
  });
});
