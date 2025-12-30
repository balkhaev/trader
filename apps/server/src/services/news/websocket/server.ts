import type { ServerWebSocket } from "bun";
import { newsEventEmitter } from "../realtime/event-emitter";
import type { ParsedArticle } from "../types";
import type {
  WsClient,
  WsClientEvent,
  WsNewsArticleEvent,
  WsServerEvent,
  WsSourceStatusEvent,
  WsStatsEvent,
} from "./types";

interface WsData {
  clientId: string;
}

class NewsWebSocketServer {
  private clients: Map<
    string,
    { ws: ServerWebSocket<WsData>; client: WsClient }
  > = new Map();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Подписываемся на события
    newsEventEmitter.onArticleSaved((article, sourceId, sourceName) => {
      this.broadcastArticle(article, sourceId, sourceName);
    });

    newsEventEmitter.onSourceConnected((sourceId, sourceName) => {
      this.broadcastSourceStatus(sourceId, sourceName, "connected");
    });

    newsEventEmitter.onSourceDisconnected((sourceId, sourceName) => {
      this.broadcastSourceStatus(sourceId, sourceName, "disconnected");
    });

    newsEventEmitter.onSourceError((sourceId, sourceName, error) => {
      this.broadcastSourceStatus(sourceId, sourceName, "error", error.message);
    });

    console.log("[NewsWebSocket] Initialized");
  }

  handleOpen(ws: ServerWebSocket<WsData>): void {
    const clientId = crypto.randomUUID();
    ws.data = { clientId };

    const client: WsClient = {
      id: clientId,
      subscriptions: {},
      connectedAt: new Date(),
    };

    this.clients.set(clientId, { ws, client });

    // Отправляем текущую статистику
    this.sendStats(ws);
  }

  handleMessage(ws: ServerWebSocket<WsData>, message: string | Buffer): void {
    const clientId = ws.data?.clientId;
    if (!clientId) return;

    const clientData = this.clients.get(clientId);
    if (!clientData) return;

    try {
      const event: WsClientEvent = JSON.parse(message.toString());

      switch (event.type) {
        case "subscribe:news": {
          clientData.client.subscriptions = event.data || {};
          break;
        }
        case "unsubscribe:news": {
          clientData.client.subscriptions = {};
          break;
        }
      }
    } catch (error) {
      console.error("[NewsWebSocket] Invalid message:", error);
    }
  }

  handleClose(ws: ServerWebSocket<WsData>): void {
    const clientId = ws.data?.clientId;
    if (clientId) {
      this.clients.delete(clientId);
    }
  }

  private broadcastArticle(
    article: ParsedArticle & { id: string },
    sourceId: string,
    sourceName: string
  ): void {
    const event: WsNewsArticleEvent = {
      type: "news:article",
      data: {
        article,
        source: {
          id: sourceId,
          name: sourceName,
          type: "web_scraper", // TODO: получать из источника
        },
      },
    };

    this.broadcast(event, (client) => {
      return this.matchesSubscription(client, article, sourceId);
    });
  }

  private broadcastSourceStatus(
    sourceId: string,
    sourceName: string,
    status: "connected" | "disconnected" | "error",
    error?: string
  ): void {
    const event: WsSourceStatusEvent = {
      type: "news:source_status",
      data: {
        sourceId,
        sourceName,
        status,
        error,
      },
    };

    this.broadcast(event);
  }

  private sendStats(ws: ServerWebSocket<WsData>): void {
    const event: WsStatsEvent = {
      type: "news:stats",
      data: {
        connectedClients: this.clients.size,
        watchingSources: 0, // TODO: получать из scheduler
        telegramChannels: 0,
      },
    };

    ws.send(JSON.stringify(event));
  }

  private broadcast(
    event: WsServerEvent,
    filter?: (client: WsClient) => boolean
  ): void {
    const message = JSON.stringify(event);

    for (const { ws, client } of this.clients.values()) {
      if (!filter || filter(client)) {
        try {
          ws.send(message);
        } catch (error) {
          console.error(
            `[NewsWebSocket] Failed to send to client ${client.id}:`,
            error
          );
        }
      }
    }
  }

  private matchesSubscription(
    client: WsClient,
    article: ParsedArticle,
    sourceId: string
  ): boolean {
    const { categories, symbols, sourceIds } = client.subscriptions;

    // Если нет подписок - отправляем всё
    if (!(categories?.length || symbols?.length || sourceIds?.length)) {
      return true;
    }

    // Проверяем source
    if (sourceIds?.length && !sourceIds.includes(sourceId)) {
      return false;
    }

    // Проверяем symbols
    if (symbols?.length) {
      const articleSymbols = article.symbols || [];
      if (!symbols.some((s) => articleSymbols.includes(s))) {
        return false;
      }
    }

    return true;
  }

  getConnectedClientsCount(): number {
    return this.clients.size;
  }
}

export const newsWebSocketServer = new NewsWebSocketServer();
