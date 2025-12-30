import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  bybitService,
  type Interval,
  type MarketCategory,
} from "../services/bybit.service";

const dataImport = new Hono();

// GET /api/data/symbols - список символов с биржи
dataImport.get(
  "/symbols",
  zValidator(
    "query",
    z.object({
      exchange: z.enum(["bybit"]).default("bybit"),
      category: z.enum(["spot", "linear"]).default("spot"),
    })
  ),
  async (c) => {
    const { exchange, category } = c.req.valid("query");

    if (exchange === "bybit") {
      try {
        const symbols = await bybitService.getSymbols(
          category as MarketCategory
        );
        return c.json({
          exchange,
          category,
          symbols: symbols.filter((s) => s.status === "Trading"),
        });
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          500
        );
      }
    }

    return c.json({ error: "Exchange not supported" }, 400);
  }
);

// GET /api/data/existing - список уже загруженных данных
dataImport.get("/existing", async (c) => {
  try {
    const data = await bybitService.getExistingData();
    return c.json(data);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
});

// POST /api/data/import - запустить импорт
dataImport.post(
  "/import",
  zValidator(
    "json",
    z.object({
      exchange: z.enum(["bybit"]).default("bybit"),
      category: z.enum(["spot", "linear"]),
      symbol: z.string(),
      interval: z.enum([
        "1",
        "3",
        "5",
        "15",
        "30",
        "60",
        "120",
        "240",
        "360",
        "720",
        "D",
        "W",
        "M",
      ]),
      startDate: z.string().transform((s) => new Date(s)),
      endDate: z.string().transform((s) => new Date(s)),
    })
  ),
  async (c) => {
    const { exchange, category, symbol, interval, startDate, endDate } =
      c.req.valid("json");

    if (exchange === "bybit") {
      try {
        const importId = await bybitService.startImport(
          category as MarketCategory,
          symbol,
          interval as Interval,
          startDate,
          endDate
        );

        return c.json({ importId, status: "started" });
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : "Unknown error" },
          500
        );
      }
    }

    return c.json({ error: "Exchange not supported" }, 400);
  }
);

// GET /api/data/imports - список всех импортов
dataImport.get("/imports", (c) => {
  const imports = bybitService.getAllImports();
  return c.json(imports);
});

// GET /api/data/imports/:id - статус импорта
dataImport.get("/imports/:id", (c) => {
  const id = c.req.param("id");
  const progress = bybitService.getImportProgress(id);

  if (!progress) {
    return c.json({ error: "Import not found" }, 404);
  }

  return c.json(progress);
});

// GET /api/data/imports/:id/stream - SSE стрим прогресса импорта
dataImport.get("/imports/:id/stream", async (c) => {
  const id = c.req.param("id");

  return streamSSE(c, async (stream) => {
    let lastRecords = 0;

    const sendProgress = () => {
      const progress = bybitService.getImportProgress(id);
      if (progress && progress.totalRecords !== lastRecords) {
        lastRecords = progress.totalRecords;
        stream.writeSSE({
          data: JSON.stringify({
            status: progress.status,
            totalRecords: progress.totalRecords,
            error: progress.error,
          }),
          event: "progress",
        });
      }
      return progress;
    };

    while (true) {
      const progress = sendProgress();

      if (!progress) {
        stream.writeSSE({ data: "Import not found", event: "error" });
        break;
      }

      if (progress.status === "completed") {
        stream.writeSSE({
          data: JSON.stringify({
            status: "completed",
            totalRecords: progress.totalRecords,
          }),
          event: "done",
        });
        break;
      }

      if (progress.status === "failed") {
        stream.writeSSE({
          data: JSON.stringify({ status: "failed", error: progress.error }),
          event: "error",
        });
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
});

// GET /api/data/intervals - доступные интервалы
dataImport.get("/intervals", (c) => {
  return c.json({
    intervals: [
      { value: "1", label: "1 минута" },
      { value: "3", label: "3 минуты" },
      { value: "5", label: "5 минут" },
      { value: "15", label: "15 минут" },
      { value: "30", label: "30 минут" },
      { value: "60", label: "1 час" },
      { value: "120", label: "2 часа" },
      { value: "240", label: "4 часа" },
      { value: "360", label: "6 часов" },
      { value: "720", label: "12 часов" },
      { value: "D", label: "1 день" },
      { value: "W", label: "1 неделя" },
      { value: "M", label: "1 месяц" },
    ],
  });
});

export default dataImport;
