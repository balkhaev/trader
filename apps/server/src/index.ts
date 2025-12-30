import { auth } from "@trader/auth";
import { env } from "@trader/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { startPolymarketJobs } from "./jobs/polymarket.job";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware";
import agents from "./routes/agents";
import autoTrading from "./routes/auto-trading";
import dataImport from "./routes/data-import";
import exchange from "./routes/exchange";
import lean from "./routes/lean";
import market from "./routes/market";
import news from "./routes/news";
import notifications from "./routes/notifications";
import polymarket from "./routes/polymarket";
import predictionMarkets from "./routes/prediction-markets";
import signals from "./routes/signals";
import strategyRoutes from "./routes/strategy";
import transport from "./routes/transport";
import trends from "./routes/trends";
import { seedAgents } from "./services/agent";
import { newsService } from "./services/news/news.service";
import { newsScheduler } from "./services/news/scheduler";
import { newsWebSocketServer } from "./services/news/websocket/server";
import { transportScheduler } from "./services/transport/scheduler";

// Запускаем фоновые задачи Polymarket
startPolymarketJobs();

// Инициализируем WebSocket сервер
newsWebSocketServer.initialize();

// Автозапуск: сначала синхронизируем пресеты, потом запускаем realtime
(async () => {
  try {
    // Синхронизируем пресетные источники
    const { added, updated, skipped } = await newsService.seedPresets();
    if (added.length > 0) {
      logger.info("News sources added", {
        count: added.length,
        sources: added,
      });
    }
    if (updated.length > 0) {
      logger.info("News sources updated", {
        count: updated.length,
        sources: updated,
      });
    }
    if (skipped.length > 0) {
      logger.debug("News sources skipped", { count: skipped.length });
    }

    // Запускаем realtime
    await newsScheduler.startRealtime();
    logger.info("News realtime started");

    // Запускаем сбор транспортных данных
    transportScheduler.start();
    logger.info("Transport scheduler started");

    // Seed preset agents
    const agentSeed = await seedAgents();
    if (agentSeed.created.length > 0) {
      logger.info("Agents seeded", { agents: agentSeed.created });
    }
  } catch (err) {
    logger.error("Failed to initialize news system", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
})();

const app = new Hono();

// Global middleware
app.use("*", errorHandler);
app.use(honoLogger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// Auth routes
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// API routes
app.route("/api/agents", agents);
app.route("/api/exchange", exchange);
app.route("/api/lean", lean);
app.route("/api/data", dataImport);
app.route("/api/market", market);
app.route("/api/markets", predictionMarkets);
app.route("/api/polymarket", polymarket);
app.route("/api/news", news);
app.route("/api/signals", signals);
app.route("/api/trends", trends);
app.route("/api/transport", transport);
app.route("/api/notifications", notifications);
app.route("/api/auto-trading", autoTrading);
app.route("/api/strategy", strategyRoutes);

// Health check
app.get("/", (c) => c.text("OK"));
app.get("/health", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() })
);

// 404 handler
app.notFound(notFoundHandler);

interface WsData {
  clientId: string;
}

interface WsRouteData extends WsData {
  route: "news" | "graph";
}

// Bun server с поддержкой WebSocket
const server = Bun.serve<WsRouteData>({
  port: env.PORT,
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade для /api/news/ws
    if (url.pathname === "/api/news/ws") {
      const upgraded = server.upgrade(req, {
        data: { clientId: "", route: "news" as const },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // WebSocket upgrade для /api/trends/ws (graph updates)
    if (url.pathname === "/api/trends/ws") {
      const upgraded = server.upgrade(req, {
        data: { clientId: "", route: "graph" as const },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Обычные HTTP запросы через Hono
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      if (ws.data.route === "graph") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphWebSocketServer.handleOpen(ws as any);
      } else {
        newsWebSocketServer.handleOpen(ws);
      }
    },
    message(ws, message) {
      if (ws.data.route === "graph") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphWebSocketServer.handleMessage(ws as any, message);
      } else {
        newsWebSocketServer.handleMessage(ws, message);
      }
    },
    close(ws) {
      if (ws.data.route === "graph") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        graphWebSocketServer.handleClose(ws as any);
      } else {
        newsWebSocketServer.handleClose(ws);
      }
    },
  },
});

logger.info("Server started", {
  port: server.port,
  url: `http://localhost:${server.port}`,
});
