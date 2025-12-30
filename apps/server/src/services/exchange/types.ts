export type ExchangeType = "bybit" | "binance" | "tinkoff";

export interface Balance {
  asset: string;
  free: string;
  locked: string;
  total: string;
  usdValue?: string;
}

export interface Position {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  currentPrice: string;
  unrealizedPnl: string;
  leverage?: number;
  liquidationPrice?: string;
}

export interface OrderParams {
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  quantity: string;
  price?: string; // Required for limit orders
  stopLoss?: string;
  takeProfit?: string;
}

export interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  status: "pending" | "filled" | "cancelled" | "rejected";
  quantity: string;
  price: string;
  filledQuantity?: string;
  avgPrice?: string;
  createdAt: Date;
  updatedAt?: Date;
}

export interface Trade {
  id: string;
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  price: string;
  commission: string;
  commissionAsset: string;
  executedAt: Date;
}

export interface AccountInfo {
  totalBalance: string;
  availableBalance: string;
  unrealizedPnl: string;
  marginUsed?: string;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  testnet?: boolean;
}

export interface ExchangeService {
  readonly exchange: ExchangeType;

  // Account
  getAccountInfo(): Promise<AccountInfo>;
  getBalances(): Promise<Balance[]>;

  // Positions
  getPositions(): Promise<Position[]>;

  // Orders
  createOrder(params: OrderParams): Promise<Order>;
  cancelOrder(orderId: string, symbol: string): Promise<void>;
  getOpenOrders(symbol?: string): Promise<Order[]>;

  // History
  getOrderHistory(symbol?: string, limit?: number): Promise<Order[]>;
  getTradeHistory(symbol?: string, limit?: number): Promise<Trade[]>;

  // Market data
  getPrice(symbol: string): Promise<string>;
  getPrices(symbols: string[]): Promise<Record<string, string>>;
}
