import { auth } from "@trader/auth";
import { autoTradingConfig, db } from "@trader/db";
import { env } from "@trader/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { logger } from "./lib/logger";
import { errorHandler, notFoundHandler } from "./middleware";
import autoTrading from "./routes/auto-trading";
import exchange from "./routes/exchange";
import lean from "./routes/lean";
import signals from "./routes/signals";
import strategyRoutes from "./routes/strategy";
import { strategyScheduler } from "./services/strategy";

const app = new Hono();

app.use("*", errorHandler);
app.use(honoLogger());
app.use(
  "/*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api/exchange", exchange);
app.route("/api/lean", lean);
app.route("/api/signals", signals);
app.route("/api/auto-trading", autoTrading);
app.route("/api/strategy", strategyRoutes);

app.get("/", (c) => c.text("Consensus WIF + DOT strategy server"));
app.get("/health", (c) =>
  c.json({
    status: "ok",
    strategy: "consensus_wif_dot_v1",
    scheduler: strategyScheduler.status(),
    timestamp: new Date().toISOString(),
  })
);
app.notFound(notFoundHandler);

await db.update(autoTradingConfig).set({
  minSignalStrength: "0",
  allowedSources: ["webhook"],
  allowedSymbols: ["WIFUSDT", "DOTUSDT"],
  blockedSymbols: null,
  allowLong: true,
  allowShort: false,
  positionSizeType: "risk_based",
  positionSizeValue: "1",
  defaultStopLossPercent: "0",
  defaultTakeProfitPercent: "0",
  maxOpenPositions: "2",
  orderType: "market",
  useStopLoss: true,
  useTakeProfit: true,
});

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

strategyScheduler.start();

function shutdown(signal: string) {
  logger.info("Stopping strategy server", { signal });
  strategyScheduler.stop();
  server.stop(true);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

logger.info("Consensus strategy server started", {
  port: server.port,
  scheduler: strategyScheduler.status(),
  url: `http://localhost:${server.port}`,
});
