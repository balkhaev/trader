import type { AssetInfo, OHLCV, Timeframe } from "../types";
import { BaseCollector } from "./base.collector";

interface BinanceKline {
  0: number; // Open time
  1: string; // Open price
  2: string; // High price
  3: string; // Low price
  4: string; // Close price
  5: string; // Volume
  6: number; // Close time
  7: string; // Quote asset volume
  8: number; // Number of trades
  9: string; // Taker buy base asset volume
  10: string; // Taker buy quote asset volume
  11: string; // Ignore
}

interface BinanceSymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
}

interface BinanceExchangeInfo {
  symbols: BinanceSymbolInfo[];
}

interface Binance24hTicker {
  symbol: string;
  quoteVolume: string;
  priceChangePercent: string;
  lastPrice: string;
}

const BINANCE_API_URL = "https://api.binance.com/api/v3";

export class BinanceCollector extends BaseCollector {
  readonly name = "BinanceCollector";
  readonly dataSource = "binance" as const;

  private symbolCache: Map<string, BinanceSymbolInfo> = new Map();
  private lastSymbolsFetch = 0;
  private readonly CACHE_TTL = 3_600_000; // 1 час

  /**
   * Получает OHLCV данные с Binance
   */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit = 500
  ): Promise<OHLCV[]> {
    const interval = this.timeframeToExchange(timeframe);
    const url = new URL(`${BINANCE_API_URL}/klines`);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    url.searchParams.set("limit", String(Math.min(limit, 1000))); // Binance max is 1000

    const response = await fetch(url.toString());

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Binance API error: ${response.status} - ${error}`);
    }

    const klines = (await response.json()) as BinanceKline[];

    return klines.map((kline) => ({
      timestamp: kline[0],
      open: Number.parseFloat(kline[1]),
      high: Number.parseFloat(kline[2]),
      low: Number.parseFloat(kline[3]),
      close: Number.parseFloat(kline[4]),
      volume: Number.parseFloat(kline[5]),
      quoteVolume: Number.parseFloat(kline[7]),
      trades: kline[8],
    }));
  }

  /**
   * Получает топ символов по объему торгов
   */
  async fetchTopSymbols(limit = 50): Promise<string[]> {
    const url = `${BINANCE_API_URL}/ticker/24hr`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const tickers = (await response.json()) as Binance24hTicker[];

    // Фильтруем только USDT пары и сортируем по объему
    const usdtPairs = tickers
      .filter((t) => t.symbol.endsWith("USDT"))
      .sort(
        (a, b) =>
          Number.parseFloat(b.quoteVolume) - Number.parseFloat(a.quoteVolume)
      )
      .slice(0, limit);

    return usdtPairs.map((t) => t.symbol);
  }

  /**
   * Получает информацию об активе
   */
  async getAssetInfo(symbol: string): Promise<AssetInfo> {
    await this.ensureSymbolCache();

    const symbolInfo = this.symbolCache.get(symbol);

    if (!symbolInfo) {
      throw new Error(`Symbol ${symbol} not found on Binance`);
    }

    return {
      symbol: symbolInfo.symbol,
      name: `${symbolInfo.baseAsset}/${symbolInfo.quoteAsset}`,
      baseCurrency: symbolInfo.baseAsset,
      quoteCurrency: symbolInfo.quoteAsset,
      marketType: "crypto",
      dataSource: "binance",
      sector: this.detectSector(symbolInfo.baseAsset),
      metadata: {
        exchange: "binance",
        baseAssetPrecision: symbolInfo.baseAssetPrecision,
        quoteAssetPrecision: symbolInfo.quoteAssetPrecision,
      },
    };
  }

  /**
   * Кэширует информацию о символах
   */
  private async ensureSymbolCache(): Promise<void> {
    const now = Date.now();

    if (
      this.symbolCache.size > 0 &&
      now - this.lastSymbolsFetch < this.CACHE_TTL
    ) {
      return;
    }

    const url = `${BINANCE_API_URL}/exchangeInfo`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = (await response.json()) as BinanceExchangeInfo;

    this.symbolCache.clear();
    for (const symbolInfo of data.symbols) {
      if (symbolInfo.status === "TRADING") {
        this.symbolCache.set(symbolInfo.symbol, symbolInfo);
      }
    }

    this.lastSymbolsFetch = now;
    console.log(
      `[${this.name}] Cached ${this.symbolCache.size} trading symbols`
    );
  }

  /**
   * Определяет сектор актива
   */
  private detectSector(baseAsset: string): string {
    const defiTokens = [
      "UNI",
      "AAVE",
      "COMP",
      "MKR",
      "SNX",
      "YFI",
      "SUSHI",
      "CRV",
      "1INCH",
      "CAKE",
    ];
    const layer1Tokens = [
      "ETH",
      "BNB",
      "SOL",
      "ADA",
      "AVAX",
      "DOT",
      "MATIC",
      "ATOM",
      "NEAR",
      "FTM",
    ];
    const layer2Tokens = ["ARB", "OP", "STRK", "ZK", "MANTA", "METIS"];
    const memeTokens = ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "MEME"];
    const aiTokens = ["FET", "AGIX", "OCEAN", "RNDR", "TAO", "ARKM"];
    const gamingTokens = ["AXS", "SAND", "MANA", "GALA", "ENJ", "IMX", "MAGIC"];

    if (baseAsset === "BTC") return "bitcoin";
    if (defiTokens.includes(baseAsset)) return "defi";
    if (layer1Tokens.includes(baseAsset)) return "layer1";
    if (layer2Tokens.includes(baseAsset)) return "layer2";
    if (memeTokens.includes(baseAsset)) return "meme";
    if (aiTokens.includes(baseAsset)) return "ai";
    if (gamingTokens.includes(baseAsset)) return "gaming";

    return "altcoin";
  }

  /**
   * Конвертирует таймфрейм в формат Binance
   */
  protected timeframeToExchange(timeframe: Timeframe): string {
    const mapping: Record<Timeframe, string> = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "1h": "1h",
      "4h": "4h",
      "1d": "1d",
      "1w": "1w",
    };

    return mapping[timeframe];
  }

  /**
   * Получает текущую цену символа
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const url = `${BINANCE_API_URL}/ticker/price?symbol=${symbol}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = (await response.json()) as { symbol: string; price: string };
    return Number.parseFloat(data.price);
  }

  /**
   * Получает 24h изменение цены
   */
  async get24hChange(symbol: string): Promise<{
    priceChange: number;
    priceChangePercent: number;
    volume: number;
  }> {
    const url = `${BINANCE_API_URL}/ticker/24hr?symbol=${symbol}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      priceChange: string;
      priceChangePercent: string;
      volume: string;
    };

    return {
      priceChange: Number.parseFloat(data.priceChange),
      priceChangePercent: Number.parseFloat(data.priceChangePercent),
      volume: Number.parseFloat(data.volume),
    };
  }
}

// Singleton instance
export const binanceCollector = new BinanceCollector();
