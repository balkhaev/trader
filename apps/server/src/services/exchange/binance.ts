import crypto from "node:crypto";
import type {
  AccountInfo,
  Balance,
  ExchangeCredentials,
  ExchangeService,
  Order,
  OrderParams,
  Position,
  Trade,
} from "./types";

const LIVE_API = "https://fapi.binance.com";
const TESTNET_API = "https://testnet.binancefuture.com";

interface BinanceFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
}

interface BinanceSymbolInfo {
  symbol: string;
  filters: BinanceFilter[];
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbolInfo[];
}

interface BinanceOrderResponse {
  orderId: number;
  symbol: string;
  side: string;
  type: string;
  status: string;
  origQty: string;
  price: string;
  executedQty?: string;
  avgPrice?: string;
  updateTime?: number;
  time?: number;
}

function decimalPlaces(step: string): number {
  const normalized = step.replace(/0+$/, "");
  const dot = normalized.indexOf(".");
  return dot === -1 ? 0 : normalized.length - dot - 1;
}

function floorToStep(value: number, step: number, precision: number): string {
  const floored = Math.floor((value + Number.EPSILON) / step) * step;
  return floored.toFixed(precision);
}

export class BinanceExchangeService implements ExchangeService {
  readonly exchange = "binance" as const;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;
  private exchangeInfoCache: BinanceExchangeInfo | null = null;
  private exchangeInfoFetchedAt = 0;

  constructor(credentials: ExchangeCredentials) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.baseUrl = credentials.testnet ? TESTNET_API : LIVE_API;
  }

  private sign(query: string): string {
    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(query)
      .digest("hex");
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    params: Record<string, string> = {},
    signed = true
  ): Promise<T> {
    const payload: Record<string, string> = { ...params };
    if (signed) {
      payload.recvWindow = "5000";
      payload.timestamp = String(Date.now());
    }
    const query = new URLSearchParams(payload).toString();
    const signature = signed ? `&signature=${this.sign(query)}` : "";
    const encoded = `${query}${signature}`;
    const url =
      method === "GET" || method === "DELETE"
        ? `${this.baseUrl}${endpoint}${encoded ? `?${encoded}` : ""}`
        : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-MBX-APIKEY": this.apiKey,
      },
      body: method === "POST" ? encoded : undefined,
    });
    if (!response.ok) {
      throw new Error(
        `Binance USD-M API ${response.status}: ${await response.text()}`
      );
    }
    return (await response.json()) as T;
  }

  private async getExchangeInfo(): Promise<BinanceExchangeInfo> {
    if (
      this.exchangeInfoCache &&
      Date.now() - this.exchangeInfoFetchedAt < 60 * 60_000
    ) {
      return this.exchangeInfoCache;
    }
    this.exchangeInfoCache = await this.request<BinanceExchangeInfo>(
      "/fapi/v1/exchangeInfo",
      "GET",
      {},
      false
    );
    this.exchangeInfoFetchedAt = Date.now();
    return this.exchangeInfoCache;
  }

  private async normalizeQuantity(
    symbol: string,
    quantity: string
  ): Promise<string> {
    const info = await this.getExchangeInfo();
    const symbolInfo = info.symbols.find((item) => item.symbol === symbol);
    const filter =
      symbolInfo?.filters.find(
        (item) => item.filterType === "MARKET_LOT_SIZE"
      ) ?? symbolInfo?.filters.find((item) => item.filterType === "LOT_SIZE");
    const stepSize = Number(filter?.stepSize ?? "0.000001");
    const minQty = Number(filter?.minQty ?? "0");
    const normalized = floorToStep(
      Number(quantity),
      stepSize,
      decimalPlaces(filter?.stepSize ?? "0.000001")
    );
    if (Number(normalized) < minQty || Number(normalized) <= 0) {
      throw new Error(
        `${symbol} quantity ${normalized} is below minimum ${minQty}`
      );
    }
    return normalized;
  }

  private async normalizePrice(symbol: string, price: string): Promise<string> {
    const info = await this.getExchangeInfo();
    const symbolInfo = info.symbols.find((item) => item.symbol === symbol);
    const filter = symbolInfo?.filters.find(
      (item) => item.filterType === "PRICE_FILTER"
    );
    const tickSize = Number(filter?.tickSize ?? "0.000001");
    return floorToStep(
      Number(price),
      tickSize,
      decimalPlaces(filter?.tickSize ?? "0.000001")
    );
  }

  private mapOrder(row: BinanceOrderResponse): Order {
    const statusMap: Record<string, Order["status"]> = {
      NEW: "pending",
      PARTIALLY_FILLED: "pending",
      FILLED: "filled",
      CANCELED: "cancelled",
      EXPIRED: "cancelled",
      REJECTED: "rejected",
    };
    return {
      id: String(row.orderId),
      symbol: row.symbol,
      side: row.side.toLowerCase() as "buy" | "sell",
      type: row.type.toLowerCase().includes("limit") ? "limit" : "market",
      status: statusMap[row.status] ?? "pending",
      quantity: row.origQty,
      price: row.price,
      filledQuantity: row.executedQty,
      avgPrice: row.avgPrice,
      createdAt: new Date(row.time ?? Date.now()),
      updatedAt: row.updateTime ? new Date(row.updateTime) : undefined,
    };
  }

  async getAccountInfo(): Promise<AccountInfo> {
    interface AccountResponse {
      totalWalletBalance: string;
      availableBalance: string;
      totalUnrealizedProfit: string;
      totalInitialMargin: string;
    }
    const account = await this.request<AccountResponse>("/fapi/v3/account");
    return {
      totalBalance: account.totalWalletBalance,
      availableBalance: account.availableBalance,
      unrealizedPnl: account.totalUnrealizedProfit,
      marginUsed: account.totalInitialMargin,
    };
  }

  async getBalances(): Promise<Balance[]> {
    interface BalanceRow {
      asset: string;
      balance: string;
      availableBalance: string;
      crossUnPnl: string;
    }
    const rows = await this.request<BalanceRow[]>("/fapi/v3/balance");
    return rows
      .filter((row) => Number(row.balance) !== 0)
      .map((row) => ({
        asset: row.asset,
        free: row.availableBalance,
        locked: String(Number(row.balance) - Number(row.availableBalance)),
        total: row.balance,
        usdValue: String(Number(row.balance) + Number(row.crossUnPnl)),
      }));
  }

  async getPositions(): Promise<Position[]> {
    interface PositionRow {
      symbol: string;
      positionAmt: string;
      entryPrice: string;
      markPrice: string;
      unRealizedProfit: string;
      leverage: string;
      liquidationPrice: string;
    }
    const rows = await this.request<PositionRow[]>("/fapi/v3/positionRisk");
    return rows
      .filter((row) => Number(row.positionAmt) !== 0)
      .map((row) => ({
        symbol: row.symbol,
        side: Number(row.positionAmt) > 0 ? "long" : "short",
        quantity: String(Math.abs(Number(row.positionAmt))),
        entryPrice: row.entryPrice,
        currentPrice: row.markPrice,
        unrealizedPnl: row.unRealizedProfit,
        leverage: Number(row.leverage),
        liquidationPrice: row.liquidationPrice,
      }));
  }

  private async placeProtection(
    symbol: string,
    side: "buy" | "sell",
    type: "STOP_MARKET" | "TAKE_PROFIT_MARKET",
    stopPrice: string
  ): Promise<void> {
    await this.request<BinanceOrderResponse>("/fapi/v1/order", "POST", {
      symbol,
      side: side === "buy" ? "BUY" : "SELL",
      type,
      stopPrice: await this.normalizePrice(symbol, stopPrice),
      closePosition: "true",
      workingType: "MARK_PRICE",
      priceProtect: "TRUE",
    });
  }

  async createOrder(params: OrderParams): Promise<Order> {
    const quantity = await this.normalizeQuantity(
      params.symbol,
      params.quantity
    );
    const orderParams: Record<string, string> = {
      symbol: params.symbol,
      side: params.side === "buy" ? "BUY" : "SELL",
      type: params.type === "market" ? "MARKET" : "LIMIT",
      quantity,
      newOrderRespType: "RESULT",
    };
    if (params.reduceOnly) orderParams.reduceOnly = "true";
    if (params.type === "limit") {
      if (!params.price) throw new Error("Limit price is required");
      orderParams.price = await this.normalizePrice(
        params.symbol,
        params.price
      );
      orderParams.timeInForce = "GTC";
    }

    const response = await this.request<BinanceOrderResponse>(
      "/fapi/v1/order",
      "POST",
      orderParams
    );

    if (!params.reduceOnly && (params.stopLoss || params.takeProfit)) {
      const protectiveSide = params.side === "buy" ? "sell" : "buy";
      try {
        if (params.stopLoss) {
          await this.placeProtection(
            params.symbol,
            protectiveSide,
            "STOP_MARKET",
            params.stopLoss
          );
        }
        if (params.takeProfit) {
          await this.placeProtection(
            params.symbol,
            protectiveSide,
            "TAKE_PROFIT_MARKET",
            params.takeProfit
          );
        }
      } catch (error) {
        await this.request<BinanceOrderResponse>("/fapi/v1/order", "POST", {
          symbol: params.symbol,
          side: protectiveSide === "buy" ? "BUY" : "SELL",
          type: "MARKET",
          quantity,
          reduceOnly: "true",
        }).catch(() => undefined);
        throw new Error(
          `Protection order failed; position flatten attempted: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return this.mapOrder(response);
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    await this.request("/fapi/v1/order", "DELETE", { symbol, orderId });
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    const rows = await this.request<BinanceOrderResponse[]>(
      "/fapi/v1/openOrders",
      "GET",
      symbol ? { symbol } : {}
    );
    return rows.map((row) => this.mapOrder(row));
  }

  async getOrderHistory(symbol?: string, limit = 50): Promise<Order[]> {
    const rows = await this.request<BinanceOrderResponse[]>(
      "/fapi/v1/allOrders",
      "GET",
      { ...(symbol ? { symbol } : {}), limit: String(limit) }
    );
    return rows.map((row) => this.mapOrder(row));
  }

  async getTradeHistory(symbol?: string, limit = 50): Promise<Trade[]> {
    interface TradeRow {
      id: number;
      orderId: number;
      symbol: string;
      side: string;
      qty: string;
      price: string;
      commission: string;
      commissionAsset: string;
      time: number;
    }
    const rows = await this.request<TradeRow[]>("/fapi/v1/userTrades", "GET", {
      ...(symbol ? { symbol } : {}),
      limit: String(limit),
    });
    return rows.map((row) => ({
      id: String(row.id),
      orderId: String(row.orderId),
      symbol: row.symbol,
      side: row.side.toLowerCase() as "buy" | "sell",
      quantity: row.qty,
      price: row.price,
      commission: row.commission,
      commissionAsset: row.commissionAsset,
      executedAt: new Date(row.time),
    }));
  }

  async getPrice(symbol: string): Promise<string> {
    const row = await this.request<{ symbol: string; price: string }>(
      "/fapi/v1/ticker/price",
      "GET",
      { symbol },
      false
    );
    return row.price;
  }

  async getPrices(symbols: string[]): Promise<Record<string, string>> {
    const rows = await this.request<Array<{ symbol: string; price: string }>>(
      "/fapi/v1/ticker/price",
      "GET",
      {},
      false
    );
    return Object.fromEntries(
      rows
        .filter((row) => symbols.includes(row.symbol))
        .map((row) => [row.symbol, row.price])
    );
  }
}
