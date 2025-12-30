import type { AssetInfo, OHLCV, Timeframe } from "../types";
import { BaseCollector } from "./base.collector";

// Yahoo Finance API URLs
const YAHOO_API_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";

// Популярные ETF и индексы для отслеживания
const POPULAR_ETFS = [
  // S&P 500 ETFs
  "SPY", // SPDR S&P 500 ETF
  "VOO", // Vanguard S&P 500 ETF
  "IVV", // iShares Core S&P 500 ETF
  // Nasdaq
  "QQQ", // Invesco QQQ Trust
  "TQQQ", // ProShares UltraPro QQQ
  // Total Market
  "VTI", // Vanguard Total Stock Market ETF
  "ITOT", // iShares Core S&P Total US Stock Market
  // International
  "VEA", // Vanguard FTSE Developed Markets ETF
  "VWO", // Vanguard FTSE Emerging Markets ETF
  "EFA", // iShares MSCI EAFE ETF
  // Sector ETFs
  "XLK", // Technology Select Sector SPDR
  "XLF", // Financial Select Sector SPDR
  "XLE", // Energy Select Sector SPDR
  "XLV", // Health Care Select Sector SPDR
  "XLI", // Industrial Select Sector SPDR
  // Bonds
  "BND", // Vanguard Total Bond Market ETF
  "TLT", // iShares 20+ Year Treasury Bond ETF
  "AGG", // iShares Core US Aggregate Bond ETF
  // Commodities
  "GLD", // SPDR Gold Shares
  "SLV", // iShares Silver Trust
  "USO", // United States Oil Fund
  // Real Estate
  "VNQ", // Vanguard Real Estate ETF
  // Crypto-related
  "BITO", // ProShares Bitcoin Strategy ETF
  // Volatility
  "VXX", // iPath Series B S&P 500 VIX
  // Leveraged
  "SOXL", // Direxion Daily Semiconductor Bull 3X
  "ARKK", // ARK Innovation ETF
];

// Популярные акции S&P 500
const SP500_STOCKS = [
  "AAPL", // Apple
  "MSFT", // Microsoft
  "GOOGL", // Alphabet
  "AMZN", // Amazon
  "NVDA", // NVIDIA
  "META", // Meta
  "TSLA", // Tesla
  "BRK-B", // Berkshire Hathaway
  "JPM", // JPMorgan Chase
  "V", // Visa
  "UNH", // UnitedHealth
  "MA", // Mastercard
  "HD", // Home Depot
  "PG", // Procter & Gamble
  "JNJ", // Johnson & Johnson
  "XOM", // Exxon Mobil
  "CVX", // Chevron
  "ABBV", // AbbVie
  "KO", // Coca-Cola
  "PEP", // PepsiCo
];

// Секторы для ETF
const ETF_SECTORS: Record<string, string> = {
  SPY: "index",
  VOO: "index",
  IVV: "index",
  QQQ: "technology",
  TQQQ: "technology",
  VTI: "total_market",
  ITOT: "total_market",
  VEA: "international",
  VWO: "emerging_markets",
  EFA: "international",
  XLK: "technology",
  XLF: "financials",
  XLE: "energy",
  XLV: "healthcare",
  XLI: "industrials",
  BND: "bonds",
  TLT: "bonds",
  AGG: "bonds",
  GLD: "commodities",
  SLV: "commodities",
  USO: "commodities",
  VNQ: "real_estate",
  BITO: "crypto",
  VXX: "volatility",
  SOXL: "semiconductors",
  ARKK: "innovation",
};

// Секторы для акций
const STOCK_SECTORS: Record<string, string> = {
  AAPL: "technology",
  MSFT: "technology",
  GOOGL: "technology",
  AMZN: "consumer_cyclical",
  NVDA: "technology",
  META: "technology",
  TSLA: "consumer_cyclical",
  "BRK-B": "financials",
  JPM: "financials",
  V: "financials",
  UNH: "healthcare",
  MA: "financials",
  HD: "consumer_cyclical",
  PG: "consumer_defensive",
  JNJ: "healthcare",
  XOM: "energy",
  CVX: "energy",
  ABBV: "healthcare",
  KO: "consumer_defensive",
  PEP: "consumer_defensive",
};

// Yahoo API response types
interface YahooChartResult {
  chart: {
    result?: Array<{
      meta: {
        symbol: string;
        regularMarketPrice?: number;
      };
      timestamp?: number[];
      indicators: {
        quote: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      code: string;
      description: string;
    };
  };
}

interface YahooQuoteResult {
  quoteResponse: {
    result?: Array<{
      symbol: string;
      shortName?: string;
      longName?: string;
      exchange?: string;
      quoteType?: string;
      marketCap?: number;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
      regularMarketVolume?: number;
      fiftyDayAverage?: number;
      twoHundredDayAverage?: number;
      sector?: string;
    }>;
    error?: {
      code: string;
      description: string;
    };
  };
}

export class YahooCollector extends BaseCollector {
  readonly name = "YahooCollector";
  readonly dataSource = "yahoo" as const;

  /**
   * Получает OHLCV данные с Yahoo Finance
   */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit = 200
  ): Promise<OHLCV[]> {
    const interval = this.timeframeToExchange(timeframe);
    const range = this.getRangeForTimeframe(timeframe);

    try {
      const url = `${YAHOO_API_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraderBot/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`Yahoo API error: ${response.status}`);
      }

      const data = (await response.json()) as YahooChartResult;

      if (data.chart.error) {
        throw new Error(data.chart.error.description);
      }

      const result = data.chart.result?.[0];
      if (!(result?.timestamp && result.indicators.quote[0])) {
        return [];
      }

      const quote = result.indicators.quote[0];
      const candles: OHLCV[] = [];

      for (let i = 0; i < result.timestamp.length && i < limit; i++) {
        const open = quote.open?.[i];
        const high = quote.high?.[i];
        const low = quote.low?.[i];
        const close = quote.close?.[i];
        const volume = quote.volume?.[i];

        if (
          open !== null &&
          open !== undefined &&
          high !== null &&
          high !== undefined &&
          low !== null &&
          low !== undefined &&
          close !== null &&
          close !== undefined
        ) {
          candles.push({
            timestamp: result.timestamp[i] * 1000,
            open,
            high,
            low,
            close,
            volume: volume ?? 0,
          });
        }
      }

      return candles;
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Получает топ символов (ETF + акции)
   */
  async fetchTopSymbols(limit = 50): Promise<string[]> {
    const allSymbols = [...POPULAR_ETFS, ...SP500_STOCKS];
    return allSymbols.slice(0, limit);
  }

  /**
   * Получает только ETF
   */
  async fetchETFSymbols(limit = 30): Promise<string[]> {
    return POPULAR_ETFS.slice(0, limit);
  }

  /**
   * Получает только акции S&P 500
   */
  async fetchSP500Symbols(limit = 20): Promise<string[]> {
    return SP500_STOCKS.slice(0, limit);
  }

  /**
   * Получает информацию об активе
   */
  async getAssetInfo(symbol: string): Promise<AssetInfo> {
    try {
      const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbol)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraderBot/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`Yahoo API error: ${response.status}`);
      }

      const data = (await response.json()) as YahooQuoteResult;
      const quote = data.quoteResponse.result?.[0];

      if (!quote) {
        throw new Error("Quote not found");
      }

      const isETF = POPULAR_ETFS.includes(symbol);
      const sector = isETF
        ? ETF_SECTORS[symbol] || "etf"
        : STOCK_SECTORS[symbol] || quote.sector || "stock";

      return {
        symbol,
        name: quote.shortName || quote.longName || symbol,
        baseCurrency: symbol,
        quoteCurrency: "USD",
        marketType: isETF ? "etf" : "stock",
        dataSource: "yahoo",
        sector,
        metadata: {
          exchange: quote.exchange,
          marketCap: quote.marketCap,
          description: quote.longName,
          regularMarketPrice: quote.regularMarketPrice,
          regularMarketChange: quote.regularMarketChange,
          regularMarketChangePercent: quote.regularMarketChangePercent,
          fiftyDayAverage: quote.fiftyDayAverage,
          twoHundredDayAverage: quote.twoHundredDayAverage,
        },
      };
    } catch {
      // Fallback если API недоступен
      const isETF = POPULAR_ETFS.includes(symbol);
      return {
        symbol,
        name: symbol,
        baseCurrency: symbol,
        quoteCurrency: "USD",
        marketType: isETF ? "etf" : "stock",
        dataSource: "yahoo",
        sector: isETF
          ? ETF_SECTORS[symbol] || "etf"
          : STOCK_SECTORS[symbol] || "stock",
      };
    }
  }

  /**
   * Конвертирует таймфрейм в формат Yahoo Finance
   */
  protected timeframeToExchange(timeframe: Timeframe): string {
    const mapping: Record<Timeframe, string> = {
      "1m": "1m",
      "5m": "5m",
      "15m": "15m",
      "1h": "1h",
      "4h": "1h", // Yahoo не поддерживает 4h, используем 1h
      "1d": "1d",
      "1w": "1wk",
    };

    return mapping[timeframe];
  }

  /**
   * Получает range для запроса
   */
  private getRangeForTimeframe(timeframe: Timeframe): string {
    switch (timeframe) {
      case "1m":
        return "7d"; // Yahoo ограничивает 1m до 7 дней
      case "5m":
        return "60d";
      case "15m":
        return "60d";
      case "1h":
      case "4h":
        return "2y";
      case "1d":
        return "5y";
      case "1w":
        return "10y";
    }
  }

  /**
   * Получает текущую цену
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbol)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraderBot/1.0)",
        },
      });

      if (!response.ok) {
        return 0;
      }

      const data = (await response.json()) as YahooQuoteResult;
      return data.quoteResponse.result?.[0]?.regularMarketPrice ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Получает изменение за 24 часа
   */
  async get24hChange(symbol: string): Promise<{
    priceChange: number;
    priceChangePercent: number;
    volume: number;
  }> {
    try {
      const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbol)}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TraderBot/1.0)",
        },
      });

      if (!response.ok) {
        return { priceChange: 0, priceChangePercent: 0, volume: 0 };
      }

      const data = (await response.json()) as YahooQuoteResult;
      const quote = data.quoteResponse.result?.[0];

      return {
        priceChange: quote?.regularMarketChange ?? 0,
        priceChangePercent: quote?.regularMarketChangePercent ?? 0,
        volume: quote?.regularMarketVolume ?? 0,
      };
    } catch {
      return { priceChange: 0, priceChangePercent: 0, volume: 0 };
    }
  }

  /**
   * Поиск символов
   */
  async searchSymbols(
    query: string
  ): Promise<Array<{ symbol: string; name: string; type: string }>> {
    try {
      // Simple search in predefined lists
      const lowerQuery = query.toLowerCase();
      const results: Array<{ symbol: string; name: string; type: string }> = [];

      for (const symbol of POPULAR_ETFS) {
        if (symbol.toLowerCase().includes(lowerQuery)) {
          results.push({ symbol, name: symbol, type: "etf" });
        }
      }

      for (const symbol of SP500_STOCKS) {
        if (symbol.toLowerCase().includes(lowerQuery)) {
          results.push({ symbol, name: symbol, type: "stock" });
        }
      }

      return results.slice(0, 10);
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const yahooCollector = new YahooCollector();
