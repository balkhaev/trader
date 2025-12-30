import type { ParsedArticle } from "../types";

// Server -> Client events
export interface WsNewsArticleEvent {
  type: "news:article";
  data: {
    article: ParsedArticle & { id: string };
    source: {
      id: string;
      name: string;
      type: string;
    };
  };
}

export interface WsSourceStatusEvent {
  type: "news:source_status";
  data: {
    sourceId: string;
    sourceName: string;
    status: "connected" | "disconnected" | "error";
    error?: string;
  };
}

export interface WsStatsEvent {
  type: "news:stats";
  data: {
    connectedClients: number;
    watchingSources: number;
    telegramChannels: number;
  };
}

// Client -> Server events
export interface WsSubscribeEvent {
  type: "subscribe:news";
  data?: {
    categories?: string[];
    symbols?: string[];
    sourceIds?: string[];
  };
}

export interface WsUnsubscribeEvent {
  type: "unsubscribe:news";
}

export type WsServerEvent =
  | WsNewsArticleEvent
  | WsSourceStatusEvent
  | WsStatsEvent;

export type WsClientEvent = WsSubscribeEvent | WsUnsubscribeEvent;

// Client state
export interface WsClient {
  id: string;
  subscriptions: {
    categories?: string[];
    symbols?: string[];
    sourceIds?: string[];
  };
  connectedAt: Date;
}
