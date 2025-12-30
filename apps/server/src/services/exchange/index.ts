import { BybitExchangeService } from "./bybit";
import type {
  ExchangeCredentials,
  ExchangeService,
  ExchangeType,
} from "./types";

export { BybitExchangeService } from "./bybit";
export * from "./types";

export function createExchangeService(
  exchange: ExchangeType,
  credentials: ExchangeCredentials
): ExchangeService {
  switch (exchange) {
    case "bybit":
      return new BybitExchangeService(credentials);
    case "binance":
      throw new Error("Binance integration not implemented yet");
    case "tinkoff":
      throw new Error("Tinkoff integration not implemented yet");
    default:
      throw new Error(`Unknown exchange: ${exchange}`);
  }
}
