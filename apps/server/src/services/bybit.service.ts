import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import archiver from "archiver";

const BYBIT_API_BASE = "https://api.bybit.com";
const LEAN_DATA_PATH =
  process.env.LEAN_DATA_PATH || "/Users/balkhaev/mycode/trader/apps/lean/data";

export type MarketCategory = "spot" | "linear";
export type Interval =
  | "1"
  | "3"
  | "5"
  | "15"
  | "30"
  | "60"
  | "120"
  | "240"
  | "360"
  | "720"
  | "D"
  | "W"
  | "M";

export interface KlineData {
  startTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

export interface Symbol {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
}

export interface ImportProgress {
  id: string;
  symbol: string;
  category: MarketCategory;
  interval: Interval;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  totalRecords: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

const runningImports = new Map<string, ImportProgress>();

const intervalToFolder: Record<Interval, string> = {
  "1": "minute",
  "3": "minute",
  "5": "minute",
  "15": "minute",
  "30": "minute",
  "60": "hour",
  "120": "hour",
  "240": "hour",
  "360": "hour",
  "720": "hour",
  D: "daily",
  W: "daily",
  M: "daily",
};

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: {
    list: T[];
  };
}

export const bybitService = {
  async getSymbols(category: MarketCategory): Promise<Symbol[]> {
    const url = `${BYBIT_API_BASE}/v5/market/instruments-info?category=${category}`;
    const response = await fetch(url);
    const data = (await response.json()) as BybitResponse<
      Record<string, string>
    >;

    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    return data.result.list.map((item) => ({
      symbol: item.symbol ?? "",
      baseCoin: item.baseCoin ?? "",
      quoteCoin: item.quoteCoin ?? "",
      status: item.status ?? "",
    }));
  },

  async getKlines(
    category: MarketCategory,
    symbol: string,
    interval: Interval,
    start?: number,
    end?: number,
    limit = 1000
  ): Promise<KlineData[]> {
    const params = new URLSearchParams({
      category,
      symbol,
      interval,
      limit: String(limit),
    });

    if (start) params.set("start", String(start));
    if (end) params.set("end", String(end));

    const url = `${BYBIT_API_BASE}/v5/market/kline?${params}`;
    const response = await fetch(url);
    const data = (await response.json()) as BybitResponse<string[]>;

    if (data.retCode !== 0) {
      throw new Error(`Bybit API error: ${data.retMsg}`);
    }

    // Bybit возвращает данные от новых к старым, разворачиваем
    return data.result.list
      .map((item) => ({
        startTime: Number(item[0]),
        open: item[1] ?? "0",
        high: item[2] ?? "0",
        low: item[3] ?? "0",
        close: item[4] ?? "0",
        volume: item[5] ?? "0",
        turnover: item[6] ?? "0",
      }))
      .reverse();
  },

  async fetchAllKlines(
    category: MarketCategory,
    symbol: string,
    interval: Interval,
    startDate: Date,
    endDate: Date,
    onProgress?: (loaded: number) => void
  ): Promise<KlineData[]> {
    const allKlines: KlineData[] = [];
    let currentEnd = endDate.getTime();
    const startTime = startDate.getTime();

    while (currentEnd > startTime) {
      const klines = await this.getKlines(
        category,
        symbol,
        interval,
        undefined,
        currentEnd,
        1000
      );

      if (klines.length === 0) break;

      // Фильтруем только те, что в диапазоне
      const filtered = klines.filter(
        (k) => k.startTime >= startTime && k.startTime <= endDate.getTime()
      );

      allKlines.unshift(...filtered);

      if (onProgress) {
        onProgress(allKlines.length);
      }

      // Следующий запрос от самой старой свечи
      const firstKline = klines[0];
      if (!firstKline) break;
      currentEnd = firstKline.startTime - 1;

      // Задержка чтобы не превысить лимиты API
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return allKlines;
  },

  convertToLeanFormat(klines: KlineData[]): string {
    return klines
      .map((k) => {
        const open = Number.parseFloat(k.open);
        const high = Number.parseFloat(k.high);
        const low = Number.parseFloat(k.low);
        const close = Number.parseFloat(k.close);

        // Lean формат: timestamp,open,high,low,close,openBid,highBid,lowBid,closeBid
        // Для упрощения bid = price * 1.0001 (как в существующих данных)
        const multiplier = 1.0001;
        return [
          k.startTime,
          open.toFixed(8),
          high.toFixed(8),
          low.toFixed(8),
          close.toFixed(8),
          (open * multiplier).toFixed(8),
          (high * multiplier).toFixed(8),
          (low * multiplier).toFixed(8),
          (close * multiplier).toFixed(8),
        ].join(",");
      })
      .join("\n");
  },

  async saveToLeanFormat(
    category: MarketCategory,
    symbol: string,
    interval: Interval,
    klines: KlineData[]
  ): Promise<string> {
    const folder = intervalToFolder[interval];
    const categoryFolder = category === "linear" ? "bybit-perpetual" : "bybit";
    const dataDir = path.join(LEAN_DATA_PATH, "crypto", categoryFolder, folder);

    await fs.mkdir(dataDir, { recursive: true });

    const csvContent = this.convertToLeanFormat(klines);
    const symbolLower = symbol.toLowerCase();
    const csvPath = path.join(dataDir, `${symbolLower}.csv`);
    const zipPath = path.join(dataDir, `${symbolLower}_quote.zip`);

    // Записываем CSV
    await fs.writeFile(csvPath, csvContent);

    // Создаём ZIP
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });

      output.on("close", () => resolve());
      archive.on("error", (err) => reject(err));

      archive.pipe(output);
      archive.file(csvPath, { name: `${symbolLower}.csv` });
      archive.finalize();
    });

    // Удаляем временный CSV
    await fs.unlink(csvPath);

    return zipPath;
  },

  async startImport(
    category: MarketCategory,
    symbol: string,
    interval: Interval,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const progress: ImportProgress = {
      id,
      symbol,
      category,
      interval,
      status: "running",
      progress: 0,
      totalRecords: 0,
      startedAt: new Date(),
    };

    runningImports.set(id, progress);

    // Запускаем импорт асинхронно
    this.runImport(id, category, symbol, interval, startDate, endDate).catch(
      (error) => {
        const p = runningImports.get(id);
        if (p) {
          p.status = "failed";
          p.error = error.message;
          p.completedAt = new Date();
        }
      }
    );

    return id;
  },

  async runImport(
    id: string,
    category: MarketCategory,
    symbol: string,
    interval: Interval,
    startDate: Date,
    endDate: Date
  ): Promise<void> {
    const progress = runningImports.get(id);
    if (!progress) return;

    try {
      const klines = await this.fetchAllKlines(
        category,
        symbol,
        interval,
        startDate,
        endDate,
        (loaded) => {
          progress.totalRecords = loaded;
        }
      );

      if (klines.length === 0) {
        throw new Error("No data received from Bybit API");
      }

      await this.saveToLeanFormat(category, symbol, interval, klines);

      progress.status = "completed";
      progress.completedAt = new Date();
    } catch (error) {
      progress.status = "failed";
      progress.error = error instanceof Error ? error.message : String(error);
      progress.completedAt = new Date();
      throw error;
    }
  },

  getImportProgress(id: string): ImportProgress | undefined {
    return runningImports.get(id);
  },

  getAllImports(): ImportProgress[] {
    return Array.from(runningImports.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  },

  async getExistingData(): Promise<
    Array<{
      category: string;
      interval: string;
      symbol: string;
      path: string;
    }>
  > {
    const result: Array<{
      category: string;
      interval: string;
      symbol: string;
      path: string;
    }> = [];

    const categories = ["bybit", "bybit-perpetual"];
    const intervals = ["minute", "hour", "daily"];

    for (const category of categories) {
      for (const interval of intervals) {
        const dirPath = path.join(LEAN_DATA_PATH, "crypto", category, interval);

        try {
          const files = await fs.readdir(dirPath);
          for (const file of files) {
            if (file.endsWith("_quote.zip")) {
              const symbol = file.replace("_quote.zip", "").toUpperCase();
              result.push({
                category: category === "bybit-perpetual" ? "linear" : "spot",
                interval,
                symbol,
                path: path.join(dirPath, file),
              });
            }
          }
        } catch {
          // Директория не существует
        }
      }
    }

    return result;
  },
};
