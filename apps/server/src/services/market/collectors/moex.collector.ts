import type { AssetInfo, OHLCV, Timeframe } from "../types";
import { BaseCollector } from "./base.collector";

// MOEX ISS API base URL
const MOEX_API_URL = "https://iss.moex.com/iss";

// Популярные акции MOEX (Blue Chips)
const MOEX_BLUE_CHIPS = [
  "SBER", // Сбербанк
  "GAZP", // Газпром
  "LKOH", // Лукойл
  "GMKN", // Норникель
  "NVTK", // Новатэк
  "ROSN", // Роснефть
  "YNDX", // Яндекс
  "MGNT", // Магнит
  "MTSS", // МТС
  "SNGS", // Сургутнефтегаз
  "TATN", // Татнефть
  "PLZL", // Полюс
  "NLMK", // НЛМК
  "ALRS", // Алроса
  "CHMF", // Северсталь
  "MOEX", // Московская биржа
  "PHOR", // Фосагро
  "VTBR", // ВТБ
  "RUAL", // Русал
  "POLY", // Полиметалл
  "TCSG", // TCS Group (Тинькофф)
  "OZON", // Ozon
  "FIVE", // X5 Group
  "AFLT", // Аэрофлот
  "PIKK", // ПИК
];

// Секторы для акций MOEX
const MOEX_SECTORS: Record<string, string> = {
  SBER: "financials",
  GAZP: "energy",
  LKOH: "energy",
  GMKN: "materials",
  NVTK: "energy",
  ROSN: "energy",
  YNDX: "technology",
  MGNT: "consumer",
  MTSS: "telecom",
  SNGS: "energy",
  TATN: "energy",
  PLZL: "materials",
  NLMK: "materials",
  ALRS: "materials",
  CHMF: "materials",
  MOEX: "financials",
  PHOR: "materials",
  VTBR: "financials",
  RUAL: "materials",
  POLY: "materials",
  TCSG: "financials",
  OZON: "consumer",
  FIVE: "consumer",
  AFLT: "industrials",
  PIKK: "real_estate",
};

// Типы для MOEX API ответов
interface MOEXApiResponse {
  candles?: {
    columns: string[];
    data: Array<Array<string | number>>;
  };
  securities?: {
    columns: string[];
    data: Array<Array<string | number>>;
  };
  marketdata?: {
    columns: string[];
    data: Array<Array<string | number>>;
  };
  description?: {
    columns: string[];
    data: Array<string[]>;
  };
}

export class MOEXCollector extends BaseCollector {
  readonly name = "MOEXCollector";
  readonly dataSource = "moex_iss" as const;

  /**
   * Получает OHLCV данные с MOEX ISS API
   */
  async fetchOHLCV(
    symbol: string,
    timeframe: Timeframe,
    limit = 200
  ): Promise<OHLCV[]> {
    const interval = this.timeframeToExchange(timeframe);
    const { from, till } = this.getPeriodForTimeframe(timeframe);

    try {
      // MOEX ISS API для свечей
      const url = new URL(
        `${MOEX_API_URL}/engines/stock/markets/shares/boards/TQBR/securities/${symbol}/candles.json`
      );
      url.searchParams.set("from", from);
      url.searchParams.set("till", till);
      url.searchParams.set("interval", interval);
      url.searchParams.set("iss.meta", "off");

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`MOEX API error: ${response.status}`);
      }

      const data = (await response.json()) as MOEXApiResponse;

      if (!data.candles?.data) {
        return [];
      }

      const columns = data.candles.columns;
      const rows = data.candles.data;

      const openIdx = columns.indexOf("open");
      const closeIdx = columns.indexOf("close");
      const highIdx = columns.indexOf("high");
      const lowIdx = columns.indexOf("low");
      const valueIdx = columns.indexOf("value");
      const volumeIdx = columns.indexOf("volume");
      const beginIdx = columns.indexOf("begin");

      return rows.slice(0, limit).map((row) => ({
        timestamp: new Date(row[beginIdx] as string).getTime(),
        open: row[openIdx] as number,
        high: row[highIdx] as number,
        low: row[lowIdx] as number,
        close: row[closeIdx] as number,
        volume: row[volumeIdx] as number,
        quoteVolume: row[valueIdx] as number,
      }));
    } catch (error) {
      console.error(`[${this.name}] Error fetching ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Получает топ символов MOEX
   */
  async fetchTopSymbols(limit = 25): Promise<string[]> {
    return MOEX_BLUE_CHIPS.slice(0, limit);
  }

  /**
   * Получает все акции с MOEX по объёму торгов
   */
  async fetchAllSecurities(): Promise<string[]> {
    try {
      const url = `${MOEX_API_URL}/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off`;
      const response = await fetch(url);

      if (!response.ok) {
        return MOEX_BLUE_CHIPS;
      }

      const data = (await response.json()) as MOEXApiResponse;

      if (!data.securities?.data) {
        return MOEX_BLUE_CHIPS;
      }

      const columns = data.securities.columns;
      const rows = data.securities.data;

      const secIdIdx = columns.indexOf("SECID");
      const valueIdx = columns.indexOf("VALTODAY");

      // Сортируем по объёму торгов
      const sorted = rows
        .filter((row) => (row[valueIdx] as number) > 0)
        .sort((a, b) => (b[valueIdx] as number) - (a[valueIdx] as number))
        .map((row) => row[secIdIdx] as string);

      return sorted;
    } catch (error) {
      console.error(`[${this.name}] Error fetching securities:`, error);
      return MOEX_BLUE_CHIPS;
    }
  }

  /**
   * Получает информацию об активе
   */
  async getAssetInfo(symbol: string): Promise<AssetInfo> {
    try {
      const url = `${MOEX_API_URL}/securities/${symbol}.json?iss.meta=off`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`MOEX API error: ${response.status}`);
      }

      const data = (await response.json()) as MOEXApiResponse;

      let name = symbol;
      let shortName = symbol;

      if (data.description?.data) {
        const rows = data.description.data;
        for (const row of rows) {
          if (row[0] === "NAME") name = row[2] ?? symbol;
          if (row[0] === "SHORTNAME") shortName = row[2] ?? symbol;
        }
      }

      return {
        symbol,
        name: shortName || name,
        baseCurrency: symbol,
        quoteCurrency: "RUB",
        marketType: "moex",
        dataSource: "moex_iss",
        sector: MOEX_SECTORS[symbol] || "stock",
        metadata: {
          exchange: "MOEX",
          fullName: name,
        },
      };
    } catch {
      // Fallback
      return {
        symbol,
        name: symbol,
        baseCurrency: symbol,
        quoteCurrency: "RUB",
        marketType: "moex",
        dataSource: "moex_iss",
        sector: MOEX_SECTORS[symbol] || "stock",
      };
    }
  }

  /**
   * Получает текущие котировки
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const url = `${MOEX_API_URL}/engines/stock/markets/shares/boards/TQBR/securities/${symbol}.json?iss.meta=off&iss.only=marketdata`;
      const response = await fetch(url);

      if (!response.ok) {
        return 0;
      }

      const data = (await response.json()) as MOEXApiResponse;

      if (!data.marketdata?.data?.[0]) {
        return 0;
      }

      const columns = data.marketdata.columns;
      const row = data.marketdata.data[0];
      const lastIdx = columns.indexOf("LAST");

      return (row[lastIdx] as number) || 0;
    } catch {
      return 0;
    }
  }

  /**
   * Получает изменение за день
   */
  async get24hChange(symbol: string): Promise<{
    priceChange: number;
    priceChangePercent: number;
    volume: number;
  }> {
    try {
      const url = `${MOEX_API_URL}/engines/stock/markets/shares/boards/TQBR/securities/${symbol}.json?iss.meta=off&iss.only=marketdata,securities`;
      const response = await fetch(url);

      if (!response.ok) {
        return { priceChange: 0, priceChangePercent: 0, volume: 0 };
      }

      const data = (await response.json()) as MOEXApiResponse;

      if (!data.marketdata?.data?.[0]) {
        return { priceChange: 0, priceChangePercent: 0, volume: 0 };
      }

      const mdColumns = data.marketdata.columns;
      const mdRow = data.marketdata.data[0];

      const lastIdx = mdColumns.indexOf("LAST");
      const volIdx = mdColumns.indexOf("VOLTODAY");
      const changeIdx = mdColumns.indexOf("LASTTOPREVPRICE");

      const secColumns = data.securities?.columns ?? [];
      const secRow = data.securities?.data?.[0] ?? [];
      const prevIdx = secColumns.indexOf("PREVPRICE");

      const last = (mdRow[lastIdx] as number) || 0;
      const prev = prevIdx >= 0 ? (secRow[prevIdx] as number) || 0 : 0;
      const change = last - prev;
      const changePercent =
        (mdRow[changeIdx] as number) || (prev > 0 ? (change / prev) * 100 : 0);

      return {
        priceChange: change,
        priceChangePercent: changePercent,
        volume: (mdRow[volIdx] as number) || 0,
      };
    } catch {
      return { priceChange: 0, priceChangePercent: 0, volume: 0 };
    }
  }

  /**
   * Конвертирует таймфрейм в формат MOEX
   */
  protected timeframeToExchange(timeframe: Timeframe): string {
    // MOEX intervals: 1, 10, 60, 24 (minutes), 7, 31 (days - week, month)
    const mapping: Record<Timeframe, string> = {
      "1m": "1",
      "5m": "10", // Closest available
      "15m": "10",
      "1h": "60",
      "4h": "60", // MOEX doesn't support 4h
      "1d": "24",
      "1w": "7",
    };

    return mapping[timeframe];
  }

  /**
   * Получает период для запроса
   */
  private getPeriodForTimeframe(timeframe: Timeframe): {
    from: string;
    till: string;
  } {
    const now = new Date();
    const from = new Date();

    switch (timeframe) {
      case "1m":
      case "5m":
      case "15m":
        from.setDate(from.getDate() - 7);
        break;
      case "1h":
      case "4h":
        from.setMonth(from.getMonth() - 6);
        break;
      case "1d":
        from.setFullYear(from.getFullYear() - 2);
        break;
      case "1w":
        from.setFullYear(from.getFullYear() - 5);
        break;
    }

    const formatDate = (d: Date): string => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    return {
      from: formatDate(from),
      till: formatDate(now),
    };
  }

  /**
   * Поиск акций
   */
  async searchSecurities(
    query: string
  ): Promise<Array<{ symbol: string; name: string }>> {
    try {
      const url = `${MOEX_API_URL}/securities.json?q=${encodeURIComponent(query)}&iss.meta=off&limit=20`;
      const response = await fetch(url);

      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as MOEXApiResponse;

      if (!data.securities?.data) {
        return [];
      }

      const columns = data.securities.columns;
      const rows = data.securities.data;

      const secIdIdx = columns.indexOf("secid");
      const shortNameIdx = columns.indexOf("shortname");

      return rows
        .filter((row) => row[secIdIdx])
        .map((row) => ({
          symbol: row[secIdIdx] as string,
          name: (row[shortNameIdx] as string) || (row[secIdIdx] as string),
        }));
    } catch {
      return [];
    }
  }
}

// Singleton instance
export const moexCollector = new MOEXCollector();
