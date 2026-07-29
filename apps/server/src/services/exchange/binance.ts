import crypto from "node:crypto";
import type {
  AccountInfo,
  Balance,
  ExchangeCredentials,
  ExchangePreflight,
  ExchangeService,
  Income,
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
    const encoded = signed ? `${query}&signature=${this.sign(query)}` : query;
    const url =
      method === "POST"
        ? `${this.baseUrl}${endpoint}`
        : `${this.baseUrl}${endpoint}${encoded ? `?${encoded}` : ""}`;
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

  private async symbolInfo(symbol: string): Promise<BinanceSymbolInfo> {
    const info = await this.getExchangeInfo();
    const found = info.symbols.find((item) => item.symbol === symbol);
    if (!found) throw new Error(`Binance symbol ${symbol} is unavailable`);
    return found;
  }

  private async normalizeQuantity(
    symbol: string,
    quantity: string
  ): Promise<string> {
    const info = await this.symbolInfo(symbol);
    const filter =
      info.filters.find((item) => item.filterType === "MARKET_LOT_SIZE") ??
      info.filters.find((item) => item.filterType === "LOT_SIZE");
    const rawStep = filter?.stepSize ?? "0.000001";
    const stepSize = Number(rawStep);
    const minQty = Number(filter?.minQty ?? "0");
    const normalized = floorToStep(
      Number(quantity),
      stepSize,
      decimalPlaces(rawStep)
    );
    if (!Number.isFinite(Number(normalized)) || Number(normalized) < minQty) {
      throw new Error(
        `${symbol} quantity ${normalized} is below minimum ${minQty}`
      );
    }
    return normalized;
  }

  private async normalizePrice(symbol: string, price: string): Promise<string> {
    const info = await this.symbolInfo(symbol);
    const filter = info.filters.find(
      (item) => item.filterType === "PRICE_FILTER"
    );
    const rawTick = filter?.tickSize ?? "0.000001";
    return floorToStep(
      Number(price),
      Number(rawTick),
      decimalPlaces(rawTick)
    );
  }

  private mapOrder(row: BinanceOrderResponse): Order {
    const statuses: Record<string, Order["status"]> = {
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
      status: statuses[row.status] ?? "pending",
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
      canTrade?: boolean;
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
      canTrade: account.canTrade,
    };
  }

  async getPreflight(): Promise<ExchangePreflight> {
    const [account, positionMode] = await Promise.all([
      this.getAccountInfo(),
      this.request<{ dualSidePosition: boolean }>(
        "/fapi/v1/positionSide/dual"
      ),
    ]);
    const canTrade = account.canTrade !== false;
    const oneWayMode = !positionMode.dualSidePosition;
    const messages: string[] = [];
    if (!canTrade) messages.push("Binance account trading permission is disabled");
    if (!oneWayMode) messages.push("Hedge Mode must be disabled (One-way Mode required)");
    return { canTrade, oneWayMode, messages };
  }

  async prepareSymbol(symbol: string, leverage: number): Promise<void> {
    const preflight = await this.getPreflight();
    if (!preflight.canTrade || !preflight.oneWayMode) {
      throw new Error(preflight.messages.join("; ") || "Binance preflight failed");
    }
    const normalizedLeverage = Math.max(1, Math.min(125, Math.ceil(leverage)));
    await this.request("/fapi/v1/leverage", "POST", {
      symbol,
      leverage: String(normalizedLeverage),
    });
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
    await this.request("/fapi/v1/order", "POST", {
      symbol,
      side: side === "buy" ? "BUY" : "SELL",
      type,
      stopPrice: await this.normalizePrice(symbol, stopPrice),
      closePosition: "true",
      workingType: "MARK_PRICE",
      priceProtect: "TRUE",
    });
  }

  async cancelAllOrders(symbol: string): Promise<void> {
    await this.request("/fapi/v1/allOpenOrders", "DELETE", { symbol });
  }

  private async flattenPosition(
    symbol: string,
    fallbackSide: "buy" | "sell",
    fallbackQuantity: string
  ): Promise<void> {
    const position = (await this.getPositions().catch(() => [])).find(
      (item) => item.symbol === symbol
    );
    const side = position
      ? position.side === "long"
        ? "SELL"
        : "BUY"
      : fallbackSide === "buy"
        ? "BUY"
        : "SELL";
    const quantity = position?.quantity ?? fallbackQuantity;
    if (Number(quantity) <= 0) return;
    await this.request("/fapi/v1/order", "POST", {
      symbol,
      side,
      type: "MARKET",
      quantity: await this.normalizeQuantity(symbol, quantity),
      reduceOnly: "true",
      newOrderRespType: "RESULT",
    });
  }

  async createOrder(params: OrderParams): Promise<Order> {
    const quantity = await this.normalizeQuantity(
      params.symbol,
      params.quantity
    );
    if (
      params.type === "limit" &&
      (params.stopLoss !== undefined || params.takeProfit !== undefined)
    ) {
      throw new Error("Protected strategy entries must use market orders");
    }
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
        await this.cancelAllOrders(params.symbol).catch(() => undefined);
        await this.flattenPosition(
          params.symbol,
          protectiveSide,
          quantity
        ).catch(() => undefined);
        await this.cancelAllOrders(params.symbol).catch(() => undefined);
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

  async getIncomeHistory(
    symbol: string,
    startTime: number,
    endTime = Date.now(),
    limit = 1000
  ): Promise<Income[]> {
    interface IncomeRow {
      symbol: string;
      incomeType: string;
      income: string;
      asset: string;
      time: number;
      tranId?: number;
    }
    const rows = await this.request<IncomeRow[]>("/fapi/v1/income", "GET", {
      symbol,
      startTime: String(startTime),
      endTime: String(endTime),
      limit: String(Math.min(1000, Math.max(1, limit))),
    });
    return rows.map((row) => ({
      symbol: row.symbol,
      incomeType: row.incomeType,
      income: row.income,
      asset: row.asset,
      time: row.time,
      transactionId: row.tranId ? String(row.tranId) : undefined,
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
