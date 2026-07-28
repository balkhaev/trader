import { BinanceExchangeService } from "./binance";
import { BybitExchangeService } from "./bybit";
import type {
  ExchangeCredentials,
  ExchangeService,
  ExchangeType,
} from "./types";

export { BinanceExchangeService } from "./binance";
export { BybitExchangeService } from "./bybit";
export * from "./types";

export function createExchangeService(
  exchange: ExchangeType,
  credentials: ExchangeCredentials
): ExchangeService {
  switch (exchange) {
    case "binance":
      return new BinanceExchangeService(credentials);
    case "bybit":
      return new BybitExchangeService(credentials);
    case "tinkoff":
      throw new Error("Tinkoff integration not implemented yet");
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}
