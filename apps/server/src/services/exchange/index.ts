import { BinanceExchangeService } from "./binance";
import type { ExchangeCredentials, ExchangeService } from "./types";

export { BinanceExchangeService } from "./binance";
export type {
  AccountInfo,
  Balance,
  ExchangeCredentials,
  ExchangePreflight,
  ExchangeService,
  ExchangeType,
  Income,
  Order,
  OrderParams,
  Position,
  Trade,
} from "./types";

export function createExchangeService(
  exchange: "binance",
  credentials: ExchangeCredentials
): ExchangeService {
  if (exchange !== "binance") {
    throw new Error("Consensus strategy supports Binance USD-M only");
  }
  return new BinanceExchangeService(credentials);
}
