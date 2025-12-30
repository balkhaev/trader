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

const BYBIT_API = "https://api.bybit.com";
const BYBIT_TESTNET_API = "https://api-testnet.bybit.com";

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  time: number;
}

export class BybitExchangeService implements ExchangeService {
  readonly exchange = "bybit" as const;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  constructor(credentials: ExchangeCredentials) {
    this.apiKey = credentials.apiKey;
    this.apiSecret = credentials.apiSecret;
    this.baseUrl = credentials.testnet ? BYBIT_TESTNET_API : BYBIT_API;
  }

  private sign(params: Record<string, string>, timestamp: number): string {
    const recvWindow = "5000";
    const paramStr = Object.keys(params)
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join("&");

    const signStr = `${timestamp}${this.apiKey}${recvWindow}${paramStr}`;

    return crypto
      .createHmac("sha256", this.apiSecret)
      .update(signStr)
      .digest("hex");
  }

  private async request<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    params: Record<string, string> = {}
  ): Promise<T> {
    const timestamp = Date.now();
    const signature = this.sign(params, timestamp);

    const headers = {
      "X-BAPI-API-KEY": this.apiKey,
      "X-BAPI-SIGN": signature,
      "X-BAPI-TIMESTAMP": timestamp.toString(),
      "X-BAPI-RECV-WINDOW": "5000",
      "Content-Type": "application/json",
    };

    let url = `${this.baseUrl}${endpoint}`;

    const options: RequestInit = {
      method,
      headers,
    };

    if (method === "GET" && Object.keys(params).length > 0) {
      url += `?${new URLSearchParams(params).toString()}`;
    } else if (method === "POST") {
      options.body = JSON.stringify(params);
    }

    const response = await fetch(url, options);
    const data = (await response.json()) as BybitResponse<T>;

    if (data.retCode !== 0) {
      throw new Error(
        `Bybit API error: ${data.retMsg} (code: ${data.retCode})`
      );
    }

    return data.result;
  }

  async getAccountInfo(): Promise<AccountInfo> {
    interface WalletBalance {
      totalEquity: string;
      totalAvailableBalance: string;
      totalPerpUPL: string;
      totalMarginBalance: string;
    }

    const result = await this.request<{ list: WalletBalance[] }>(
      "/v5/account/wallet-balance",
      "GET",
      { accountType: "UNIFIED" }
    );

    const account = result.list[0];
    if (!account) {
      return {
        totalBalance: "0",
        availableBalance: "0",
        unrealizedPnl: "0",
      };
    }

    return {
      totalBalance: account.totalEquity,
      availableBalance: account.totalAvailableBalance,
      unrealizedPnl: account.totalPerpUPL,
      marginUsed: (
        Number.parseFloat(account.totalMarginBalance) -
        Number.parseFloat(account.totalAvailableBalance)
      ).toString(),
    };
  }

  async getBalances(): Promise<Balance[]> {
    interface CoinBalance {
      coin: string;
      walletBalance: string;
      locked: string;
      availableToWithdraw: string;
      usdValue: string;
    }

    interface WalletResult {
      coin: CoinBalance[];
    }

    const result = await this.request<{ list: WalletResult[] }>(
      "/v5/account/wallet-balance",
      "GET",
      { accountType: "UNIFIED" }
    );

    const account = result.list[0];
    if (!account) return [];

    return account.coin
      .filter((c) => Number.parseFloat(c.walletBalance) > 0)
      .map((c) => ({
        asset: c.coin,
        free: c.availableToWithdraw,
        locked: c.locked,
        total: c.walletBalance,
        usdValue: c.usdValue,
      }));
  }

  async getPositions(): Promise<Position[]> {
    interface BybitPosition {
      symbol: string;
      side: string;
      size: string;
      avgPrice: string;
      markPrice: string;
      unrealisedPnl: string;
      leverage: string;
      liqPrice: string;
    }

    const result = await this.request<{ list: BybitPosition[] }>(
      "/v5/position/list",
      "GET",
      { category: "linear", settleCoin: "USDT" }
    );

    return result.list
      .filter((p) => Number.parseFloat(p.size) > 0)
      .map((p) => ({
        symbol: p.symbol,
        side: p.side.toLowerCase() as "long" | "short",
        quantity: p.size,
        entryPrice: p.avgPrice,
        currentPrice: p.markPrice,
        unrealizedPnl: p.unrealisedPnl,
        leverage: Number.parseInt(p.leverage, 10),
        liquidationPrice: p.liqPrice,
      }));
  }

  async createOrder(params: OrderParams): Promise<Order> {
    interface OrderResult {
      orderId: string;
      orderLinkId: string;
    }

    const orderParams: Record<string, string> = {
      category: "linear",
      symbol: params.symbol,
      side: params.side === "buy" ? "Buy" : "Sell",
      orderType: params.type === "market" ? "Market" : "Limit",
      qty: params.quantity,
    };

    if (params.type === "limit" && params.price) {
      orderParams.price = params.price;
    }

    if (params.stopLoss) {
      orderParams.stopLoss = params.stopLoss;
    }

    if (params.takeProfit) {
      orderParams.takeProfit = params.takeProfit;
    }

    const result = await this.request<OrderResult>(
      "/v5/order/create",
      "POST",
      orderParams
    );

    return {
      id: result.orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      status: "pending",
      quantity: params.quantity,
      price: params.price || "0",
      createdAt: new Date(),
    };
  }

  async cancelOrder(orderId: string, symbol: string): Promise<void> {
    await this.request("/v5/order/cancel", "POST", {
      category: "linear",
      symbol,
      orderId,
    });
  }

  async getOpenOrders(symbol?: string): Promise<Order[]> {
    interface BybitOrder {
      orderId: string;
      symbol: string;
      side: string;
      orderType: string;
      orderStatus: string;
      qty: string;
      price: string;
      cumExecQty: string;
      avgPrice: string;
      createdTime: string;
      updatedTime: string;
    }

    const params: Record<string, string> = { category: "linear" };
    if (symbol) params.symbol = symbol;

    const result = await this.request<{ list: BybitOrder[] }>(
      "/v5/order/realtime",
      "GET",
      params
    );

    return result.list.map((o) => ({
      id: o.orderId,
      symbol: o.symbol,
      side: o.side.toLowerCase() as "buy" | "sell",
      type: o.orderType.toLowerCase() as "market" | "limit",
      status: this.mapOrderStatus(o.orderStatus),
      quantity: o.qty,
      price: o.price,
      filledQuantity: o.cumExecQty,
      avgPrice: o.avgPrice,
      createdAt: new Date(Number.parseInt(o.createdTime, 10)),
      updatedAt: new Date(Number.parseInt(o.updatedTime, 10)),
    }));
  }

  async getOrderHistory(symbol?: string, limit = 50): Promise<Order[]> {
    interface BybitOrder {
      orderId: string;
      symbol: string;
      side: string;
      orderType: string;
      orderStatus: string;
      qty: string;
      price: string;
      cumExecQty: string;
      avgPrice: string;
      createdTime: string;
      updatedTime: string;
    }

    const params: Record<string, string> = {
      category: "linear",
      limit: limit.toString(),
    };
    if (symbol) params.symbol = symbol;

    const result = await this.request<{ list: BybitOrder[] }>(
      "/v5/order/history",
      "GET",
      params
    );

    return result.list.map((o) => ({
      id: o.orderId,
      symbol: o.symbol,
      side: o.side.toLowerCase() as "buy" | "sell",
      type: o.orderType.toLowerCase() as "market" | "limit",
      status: this.mapOrderStatus(o.orderStatus),
      quantity: o.qty,
      price: o.price,
      filledQuantity: o.cumExecQty,
      avgPrice: o.avgPrice,
      createdAt: new Date(Number.parseInt(o.createdTime, 10)),
      updatedAt: new Date(Number.parseInt(o.updatedTime, 10)),
    }));
  }

  async getTradeHistory(symbol?: string, limit = 50): Promise<Trade[]> {
    interface BybitTrade {
      execId: string;
      orderId: string;
      symbol: string;
      side: string;
      execQty: string;
      execPrice: string;
      execFee: string;
      feeCurrency: string;
      execTime: string;
    }

    const params: Record<string, string> = {
      category: "linear",
      limit: limit.toString(),
    };
    if (symbol) params.symbol = symbol;

    const result = await this.request<{ list: BybitTrade[] }>(
      "/v5/execution/list",
      "GET",
      params
    );

    return result.list.map((t) => ({
      id: t.execId,
      orderId: t.orderId,
      symbol: t.symbol,
      side: t.side.toLowerCase() as "buy" | "sell",
      quantity: t.execQty,
      price: t.execPrice,
      commission: t.execFee,
      commissionAsset: t.feeCurrency,
      executedAt: new Date(Number.parseInt(t.execTime, 10)),
    }));
  }

  async getPrice(symbol: string): Promise<string> {
    interface Ticker {
      lastPrice: string;
    }

    const result = await this.request<{ list: Ticker[] }>(
      "/v5/market/tickers",
      "GET",
      { category: "linear", symbol }
    );

    return result.list[0]?.lastPrice || "0";
  }

  async getPrices(symbols: string[]): Promise<Record<string, string>> {
    interface Ticker {
      symbol: string;
      lastPrice: string;
    }

    const result = await this.request<{ list: Ticker[] }>(
      "/v5/market/tickers",
      "GET",
      { category: "linear" }
    );

    const prices: Record<string, string> = {};
    for (const ticker of result.list) {
      if (symbols.includes(ticker.symbol)) {
        prices[ticker.symbol] = ticker.lastPrice;
      }
    }

    return prices;
  }

  private mapOrderStatus(
    status: string
  ): "pending" | "filled" | "cancelled" | "rejected" {
    switch (status) {
      case "Filled":
        return "filled";
      case "Cancelled":
      case "PartiallyFilledCanceled":
        return "cancelled";
      case "Rejected":
        return "rejected";
      default:
        return "pending";
    }
  }
}
