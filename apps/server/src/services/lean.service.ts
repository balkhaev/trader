import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

const LEAN_PROJECTS_PATH =
  process.env.LEAN_PROJECTS_PATH || "/Users/balkhaev/mycode/trader/apps/lean";

export interface StrategyParameter {
  value: number | string;
  type: "int" | "float" | "string";
  description: string;
}

export interface StrategyConfig {
  "algorithm-language": string;
  parameters: Record<string, StrategyParameter>;
  description?: string;
}

export interface Strategy {
  name: string;
  path: string;
  hasConfig: boolean;
  lastModified: Date;
}

export interface Trade {
  id: string;
  time: number;
  symbol: string;
  direction: "buy" | "sell";
  price: number;
  quantity: number;
  profit?: number;
}

export interface BacktestResult {
  id: string;
  strategyName: string;
  date: string;
  statistics: Record<string, string>;
  equity: Array<{ date: number; value: number }>;
  trades: number;
  orderEvents?: Trade[];
  netProfit: string;
  sharpeRatio: string;
  maxDrawdown: string;
}

export interface ListBacktestsParams {
  strategyName?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: "date" | "netProfit" | "sharpeRatio";
  sortOrder?: "asc" | "desc";
}

export interface BacktestConfig {
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  cash?: number;
  backtestName?: string;
  dataProvider?: "local" | "binance" | "quantconnect";
  parameters?: Record<string, string | number>;
}

export interface BacktestRun {
  id: string;
  process: ReturnType<typeof spawn>;
  config?: BacktestConfig;
}

const runningBacktests = new Map<string, BacktestRun>();

// Хелпер для получения пути к бэктесту по ID
// ID формат: "StrategyName__timestamp" или просто "timestamp"
// Разделитель __ используется вместо / для совместимости с URL
function getBacktestPath(id: string): string {
  if (id.includes("__")) {
    // ID содержит имя стратегии: "StrategyName__timestamp"
    const separatorIndex = id.indexOf("__");
    const strategyName = id.substring(0, separatorIndex);
    const timestamp = id.substring(separatorIndex + 2);
    return path.join(LEAN_PROJECTS_PATH, strategyName, "backtests", timestamp);
  }
  // ID без стратегии - корневая папка backtests
  return path.join(LEAN_PROJECTS_PATH, "backtests", id);
}

export const leanService = {
  async listStrategies(): Promise<Strategy[]> {
    const strategies: Strategy[] = [];

    try {
      const entries = await fs.readdir(LEAN_PROJECTS_PATH, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        if (entry.name === "data" || entry.name === "backtests") continue;

        const projectPath = path.join(LEAN_PROJECTS_PATH, entry.name);
        const mainPyPath = path.join(projectPath, "main.py");

        try {
          const stat = await fs.stat(mainPyPath);
          const configPath = path.join(projectPath, "config.json");
          let hasConfig = false;

          try {
            await fs.access(configPath);
            hasConfig = true;
          } catch {}

          strategies.push({
            name: entry.name,
            path: projectPath,
            hasConfig,
            lastModified: stat.mtime,
          });
        } catch {
          // Пропускаем директории без main.py
        }
      }

      // Также проверяем корневой main.py
      try {
        const rootMainPy = path.join(LEAN_PROJECTS_PATH, "main.py");
        const stat = await fs.stat(rootMainPy);
        strategies.unshift({
          name: "default",
          path: LEAN_PROJECTS_PATH,
          hasConfig: true,
          lastModified: stat.mtime,
        });
      } catch {}
    } catch (error) {
      console.error("Error listing strategies:", error);
    }

    return strategies;
  },

  async getStrategy(name: string): Promise<string> {
    const strategyPath =
      name === "default"
        ? path.join(LEAN_PROJECTS_PATH, "main.py")
        : path.join(LEAN_PROJECTS_PATH, name, "main.py");

    const content = await fs.readFile(strategyPath, "utf-8");
    return content;
  },

  async updateStrategy(name: string, code: string): Promise<void> {
    const strategyPath =
      name === "default"
        ? path.join(LEAN_PROJECTS_PATH, "main.py")
        : path.join(LEAN_PROJECTS_PATH, name, "main.py");

    await fs.writeFile(strategyPath, code, "utf-8");
  },

  async getStrategyConfig(name: string): Promise<StrategyConfig | null> {
    const configPath =
      name === "default"
        ? path.join(LEAN_PROJECTS_PATH, "config.json")
        : path.join(LEAN_PROJECTS_PATH, name, "config.json");

    try {
      const content = await fs.readFile(configPath, "utf-8");
      return JSON.parse(content) as StrategyConfig;
    } catch {
      return null;
    }
  },

  async updateStrategyConfig(
    name: string,
    config: StrategyConfig
  ): Promise<void> {
    const configPath =
      name === "default"
        ? path.join(LEAN_PROJECTS_PATH, "config.json")
        : path.join(LEAN_PROJECTS_PATH, name, "config.json");

    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  },

  async runBacktest(
    strategyName: string,
    onLog: (data: string) => void,
    config?: BacktestConfig
  ): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const projectPath =
      strategyName === "default"
        ? LEAN_PROJECTS_PATH
        : path.join(LEAN_PROJECTS_PATH, strategyName);

    // Собираем аргументы для lean CLI
    const args = ["backtest", "."];

    // Имя бэктеста
    if (config?.backtestName) {
      args.push("--backtest-name", config.backtestName);
    }

    // Data provider
    if (config?.dataProvider && config.dataProvider !== "local") {
      args.push("--data-provider-historical", config.dataProvider);
    }

    // Передаём параметры стратегии через --parameter
    // Это включает startDate, endDate, cash и кастомные параметры
    if (config?.startDate) {
      args.push("--parameter", "start_date", config.startDate);
    }

    if (config?.endDate) {
      args.push("--parameter", "end_date", config.endDate);
    }

    if (config?.cash) {
      args.push("--parameter", "cash", config.cash.toString());
    }

    // Кастомные параметры
    if (config?.parameters) {
      for (const [key, value] of Object.entries(config.parameters)) {
        args.push("--parameter", key, value.toString());
      }
    }

    const leanProcess = spawn("lean", args, {
      cwd: projectPath,
      shell: true,
    });

    runningBacktests.set(id, { id, process: leanProcess, config });

    leanProcess.stdout.on("data", (data) => {
      onLog(data.toString());
    });

    leanProcess.stderr.on("data", (data) => {
      onLog(`[ERROR] ${data.toString()}`);
    });

    leanProcess.on("close", (code) => {
      onLog(`[DONE] Backtest finished with code ${code}`);
      runningBacktests.delete(id);
    });

    return id;
  },

  async listBacktests(
    params: ListBacktestsParams = {}
  ): Promise<BacktestResult[]> {
    const results: BacktestResult[] = [];

    // Собираем все папки с бэктестами из всех стратегий
    const backtestDirs: Array<{ strategyName: string; backtestsPath: string }> =
      [];

    try {
      const entries = await fs.readdir(LEAN_PROJECTS_PATH, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === "node_modules")
          continue;
        if (entry.name === "data") continue;

        const backtestsPath = path.join(
          LEAN_PROJECTS_PATH,
          entry.name,
          "backtests"
        );
        try {
          await fs.access(backtestsPath);
          backtestDirs.push({
            strategyName: entry.name,
            backtestsPath,
          });
        } catch {
          // Папка backtests не существует для этой стратегии
        }
      }

      // Также проверяем корневую папку backtests (для default)
      const rootBacktests = path.join(LEAN_PROJECTS_PATH, "backtests");
      try {
        await fs.access(rootBacktests);
        backtestDirs.push({
          strategyName: "default",
          backtestsPath: rootBacktests,
        });
      } catch {}
    } catch (error) {
      console.error("Error scanning strategies:", error);
    }

    // Читаем бэктесты из всех найденных папок
    for (const { strategyName, backtestsPath } of backtestDirs) {
      try {
        const entries = await fs.readdir(backtestsPath, {
          withFileTypes: true,
        });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const backtestPath = path.join(backtestsPath, entry.name);
          try {
            const files = await fs.readdir(backtestPath);
            const summaryFile = files.find((f) => f.endsWith("-summary.json"));

            if (summaryFile) {
              const summaryPath = path.join(backtestPath, summaryFile);
              const content = await fs.readFile(summaryPath, "utf-8");
              const summary = JSON.parse(content);

              const equityValues =
                summary.charts?.["Strategy Equity"]?.series?.Equity?.values ||
                [];
              const equity = equityValues
                .filter((v: number[]) => v && v.length >= 5)
                .map((v: number[]) => ({
                  date: (v[0] ?? 0) * 1000,
                  value: v[4] ?? 0,
                }));

              // ID включает имя стратегии для уникальности (используем __ как разделитель)
              const backtestId =
                strategyName === "default"
                  ? entry.name
                  : `${strategyName}__${entry.name}`;

              results.push({
                id: backtestId,
                strategyName:
                  summary.algorithmConfiguration?.name || strategyName,
                date: entry.name,
                statistics: summary.statistics || {},
                equity,
                trades: summary.statistics?.["Total Orders"] || "0",
                netProfit: summary.statistics?.["Net Profit"] || "0%",
                sharpeRatio: summary.statistics?.["Sharpe Ratio"] || "0",
                maxDrawdown: summary.statistics?.["Drawdown"] || "0%",
              });
            }
          } catch (error) {
            console.error(`Error reading backtest ${entry.name}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error listing backtests for ${strategyName}:`, error);
      }
    }

    // Фильтрация
    let filtered = results;

    if (params.strategyName) {
      filtered = filtered.filter((b) => b.strategyName === params.strategyName);
    }

    if (params.dateFrom) {
      filtered = filtered.filter((b) => b.date >= params.dateFrom!);
    }

    if (params.dateTo) {
      filtered = filtered.filter((b) => b.date <= params.dateTo!);
    }

    // Сортировка
    const sortOrder = params.sortOrder === "asc" ? 1 : -1;

    if (params.sortBy === "netProfit") {
      filtered.sort((a, b) => {
        const aVal = Number.parseFloat(a.netProfit.replace("%", "")) || 0;
        const bVal = Number.parseFloat(b.netProfit.replace("%", "")) || 0;
        return (aVal - bVal) * sortOrder;
      });
    } else if (params.sortBy === "sharpeRatio") {
      filtered.sort((a, b) => {
        const aVal = Number.parseFloat(a.sharpeRatio) || 0;
        const bVal = Number.parseFloat(b.sharpeRatio) || 0;
        return (aVal - bVal) * sortOrder;
      });
    } else {
      // По дате (default)
      filtered.sort((a, b) => a.date.localeCompare(b.date) * sortOrder);
    }

    return filtered;
  },

  async getBacktest(id: string): Promise<BacktestResult | null> {
    const backtestPath = getBacktestPath(id);
    const dateFromId = id.includes("__")
      ? id.substring(id.indexOf("__") + 2)
      : id;

    try {
      const files = await fs.readdir(backtestPath);
      const summaryFile = files.find((f) => f.endsWith("-summary.json"));

      if (!summaryFile) return null;

      const summaryPath = path.join(backtestPath, summaryFile);
      const content = await fs.readFile(summaryPath, "utf-8");
      const summary = JSON.parse(content);

      const equityValues =
        summary.charts?.["Strategy Equity"]?.series?.Equity?.values || [];
      const equity = equityValues
        .filter((v: number[]) => v && v.length >= 5)
        .map((v: number[]) => ({
          date: (v[0] ?? 0) * 1000,
          value: v[4] ?? 0,
        }));

      return {
        id,
        strategyName: summary.algorithmConfiguration?.name || "unknown",
        date: dateFromId,
        statistics: summary.statistics || {},
        equity,
        trades: summary.statistics?.["Total Orders"] || "0",
        netProfit: summary.statistics?.["Net Profit"] || "0%",
        sharpeRatio: summary.statistics?.["Sharpe Ratio"] || "0",
        maxDrawdown: summary.statistics?.["Drawdown"] || "0%",
      };
    } catch {
      return null;
    }
  },

  async getBacktestLogs(id: string): Promise<string> {
    const backtestPath = getBacktestPath(id);
    const logPath = path.join(backtestPath, "log.txt");

    try {
      return await fs.readFile(logPath, "utf-8");
    } catch {
      return "Logs not found";
    }
  },

  async getBacktestTrades(id: string): Promise<Trade[]> {
    const backtestPath = getBacktestPath(id);

    try {
      const files = await fs.readdir(backtestPath);
      const orderEventsFile = files.find((f) =>
        f.endsWith("-order-events.json")
      );

      if (!orderEventsFile) return [];

      const filePath = path.join(backtestPath, orderEventsFile);
      const content = await fs.readFile(filePath, "utf-8");
      const events = JSON.parse(content);

      // Фильтруем только исполненные ордера (filled)
      const filledOrders = events.filter(
        (e: { status: string; fillPrice: number }) =>
          e.status === "filled" && e.fillPrice > 0
      );

      return filledOrders.map(
        (e: {
          id: string;
          time: number;
          symbolValue: string;
          direction: string;
          fillPrice: number;
          fillQuantity: number;
        }) => ({
          id: e.id,
          time: e.time * 1000,
          symbol: e.symbolValue,
          direction: e.direction as "buy" | "sell",
          price: e.fillPrice,
          quantity: e.fillQuantity,
        })
      );
    } catch {
      return [];
    }
  },

  isBacktestRunning(id: string): boolean {
    return runningBacktests.has(id);
  },

  getRunningBacktest(id: string): BacktestRun | undefined {
    return runningBacktests.get(id);
  },

  async getUniqueStrategies(): Promise<string[]> {
    const backtests = await this.listBacktests();
    const uniqueSet = new Set(backtests.map((b) => b.strategyName));
    return Array.from(uniqueSet);
  },

  async deleteBacktest(id: string): Promise<boolean> {
    const backtestPath = getBacktestPath(id);
    try {
      await fs.rm(backtestPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  },

  async deleteAllBacktests(): Promise<number> {
    // Удаляем все бэктесты из всех папок
    const backtests = await this.listBacktests();
    let deleted = 0;
    for (const bt of backtests) {
      if (await this.deleteBacktest(bt.id)) {
        deleted++;
      }
    }
    return deleted;
  },

  async deleteBacktestsByStrategy(strategyName: string): Promise<number> {
    const backtests = await this.listBacktests();
    const toDelete = backtests.filter((b) => b.strategyName === strategyName);
    let deleted = 0;
    for (const bt of toDelete) {
      if (await this.deleteBacktest(bt.id)) {
        deleted++;
      }
    }
    return deleted;
  },
};
