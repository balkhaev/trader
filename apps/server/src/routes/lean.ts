import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { leanService } from "../services/lean.service";

const lean = new Hono();

// GET /api/lean/strategies - список стратегий
lean.get("/strategies", async (c) => {
  const strategies = await leanService.listStrategies();
  return c.json(strategies);
});

// GET /api/lean/strategies/:name - код стратегии и конфиг
lean.get("/strategies/:name", async (c) => {
  const name = c.req.param("name");
  try {
    const code = await leanService.getStrategy(name);
    const config = await leanService.getStrategyConfig(name);
    return c.json({ name, code, config });
  } catch (error) {
    return c.json({ error: "Strategy not found" }, 404);
  }
});

// PUT /api/lean/strategies/:name - обновить код стратегии
lean.put(
  "/strategies/:name",
  zValidator(
    "json",
    z.object({
      code: z.string(),
    })
  ),
  async (c) => {
    const name = c.req.param("name");
    const { code } = c.req.valid("json");

    try {
      await leanService.updateStrategy(name, code);
      return c.json({ success: true });
    } catch (error) {
      return c.json({ error: "Failed to update strategy" }, 500);
    }
  }
);

// POST /api/lean/backtest - запустить бэктест
lean.post(
  "/backtest",
  zValidator(
    "json",
    z.object({
      strategyName: z.string(),
      config: z
        .object({
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          cash: z.number().optional(),
          backtestName: z.string().optional(),
          dataProvider: z.enum(["local", "binance", "quantconnect"]).optional(),
          parameters: z
            .record(z.string(), z.union([z.string(), z.number()]))
            .optional(),
        })
        .optional(),
    })
  ),
  async (c) => {
    const { strategyName, config } = c.req.valid("json");

    // Для SSE стриминга возвращаем ID бэктеста
    // Клиент затем подключается к /backtest/:id/stream
    const backtestId = await leanService.runBacktest(
      strategyName,
      () => {
        // Логи стримятся через SSE endpoint
      },
      config
    );

    return c.json({ backtestId, status: "started", config });
  }
);

// GET /api/lean/backtest/:id/stream - SSE стрим логов
lean.get("/backtest/:id/stream", async (c) => {
  const id = c.req.param("id");

  return streamSSE(c, async (stream) => {
    let isRunning = true;

    // Запускаем бэктест если еще не запущен
    // В реальности ID передается от уже запущенного процесса
    // Здесь упрощенная версия

    const sendLog = (log: string) => {
      stream.writeSSE({ data: log, event: "log" });
    };

    // Проверяем есть ли уже запущенный бэктест
    const running = leanService.getRunningBacktest(id);

    if (running) {
      running.process.stdout?.on("data", (data) => {
        sendLog(data.toString());
      });

      running.process.stderr?.on("data", (data) => {
        sendLog(`[ERROR] ${data.toString()}`);
      });

      running.process.on("close", (code) => {
        stream.writeSSE({ data: `Finished with code ${code}`, event: "done" });
        isRunning = false;
      });

      // Держим соединение открытым
      while (isRunning) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } else {
      stream.writeSSE({
        data: "Backtest not found or already finished",
        event: "error",
      });
    }
  });
});

// GET /api/lean/backtests/strategies - уникальные стратегии для фильтра
lean.get("/backtests/strategies", async (c) => {
  const strategies = await leanService.getUniqueStrategies();
  return c.json(strategies);
});

// GET /api/lean/backtests - история бэктестов с фильтрацией и сортировкой
lean.get(
  "/backtests",
  zValidator(
    "query",
    z.object({
      strategyName: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      sortBy: z.enum(["date", "netProfit", "sharpeRatio"]).optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
    })
  ),
  async (c) => {
    const params = c.req.valid("query");
    const backtests = await leanService.listBacktests(params);
    return c.json(backtests);
  }
);

// DELETE /api/lean/backtests - удалить все бэктесты (или по стратегии)
lean.delete(
  "/backtests",
  zValidator(
    "query",
    z.object({
      strategyName: z.string().optional(),
    })
  ),
  async (c) => {
    const { strategyName } = c.req.valid("query");

    let deleted: number;
    if (strategyName) {
      deleted = await leanService.deleteBacktestsByStrategy(strategyName);
    } else {
      deleted = await leanService.deleteAllBacktests();
    }

    return c.json({ success: true, deleted });
  }
);

// DELETE /api/lean/backtests/:id - удалить один бэктест
lean.delete("/backtests/:id", async (c) => {
  const id = c.req.param("id");
  const success = await leanService.deleteBacktest(id);

  if (!success) {
    return c.json({ error: "Failed to delete backtest" }, 500);
  }

  return c.json({ success: true, id });
});

// GET /api/lean/backtests/:id - результаты бэктеста
lean.get("/backtests/:id", async (c) => {
  const id = c.req.param("id");
  const backtest = await leanService.getBacktest(id);

  if (!backtest) {
    return c.json({ error: "Backtest not found" }, 404);
  }

  return c.json(backtest);
});

// GET /api/lean/backtests/:id/logs - логи бэктеста
lean.get("/backtests/:id/logs", async (c) => {
  const id = c.req.param("id");
  const logs = await leanService.getBacktestLogs(id);
  return c.json({ logs });
});

// GET /api/lean/backtests/:id/trades - сделки бэктеста
lean.get("/backtests/:id/trades", async (c) => {
  const id = c.req.param("id");
  const trades = await leanService.getBacktestTrades(id);
  return c.json(trades);
});

// ============ Portfolio Optimization (proxy to Python service) ============

const PORTFOLIO_SERVICE_URL =
  process.env.PORTFOLIO_SERVICE_URL || "http://localhost:8000";

// GET /api/lean/portfolio/symbols - доступные символы
lean.get("/portfolio/symbols", async (c) => {
  try {
    const res = await fetch(`${PORTFOLIO_SERVICE_URL}/symbols`);
    return c.json(await res.json());
  } catch {
    return c.json({ error: "Portfolio service unavailable" }, 503);
  }
});

// POST /api/lean/portfolio/optimize - оптимизация портфеля
lean.post(
  "/portfolio/optimize",
  zValidator(
    "json",
    z.object({
      symbols: z.array(z.string()).min(2),
      method: z
        .enum([
          "max_sharpe",
          "min_volatility",
          "efficient_risk",
          "efficient_return",
          "hrp",
          "black_litterman",
        ])
        .default("max_sharpe"),
      target_return: z.number().optional(),
      target_volatility: z.number().optional(),
      risk_free_rate: z.number().default(0.02),
      total_portfolio_value: z.number().default(10_000),
      lookback_days: z.number().default(365),
    })
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      const res = await fetch(`${PORTFOLIO_SERVICE_URL}/optimize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json();
        return c.json(error, res.status as 400 | 404 | 500);
      }

      return c.json(await res.json());
    } catch {
      return c.json({ error: "Portfolio service unavailable" }, 503);
    }
  }
);

// POST /api/lean/portfolio/efficient-frontier - граница эффективности
lean.post(
  "/portfolio/efficient-frontier",
  zValidator(
    "json",
    z.object({
      symbols: z.array(z.string()).min(2),
      risk_free_rate: z.number().default(0.02),
      lookback_days: z.number().default(365),
    })
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      const res = await fetch(`${PORTFOLIO_SERVICE_URL}/efficient-frontier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      return c.json(await res.json());
    } catch {
      return c.json({ error: "Portfolio service unavailable" }, 503);
    }
  }
);

// POST /api/lean/portfolio/generate-weights - генерация кода для Lean
lean.post(
  "/portfolio/generate-weights",
  zValidator(
    "json",
    z.object({
      symbols: z.array(z.string()).min(2),
      method: z.string().default("max_sharpe"),
      lookback_days: z.number().default(365),
    })
  ),
  async (c) => {
    const body = c.req.valid("json");

    try {
      const res = await fetch(
        `${PORTFOLIO_SERVICE_URL}/generate-lean-weights`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      return c.json(await res.json());
    } catch {
      return c.json({ error: "Portfolio service unavailable" }, 503);
    }
  }
);

export default lean;
