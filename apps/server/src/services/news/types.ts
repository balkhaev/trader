export interface ParsedArticle {
  externalId: string;
  url: string;
  title: string;
  content?: string;
  summary?: string;
  author?: string;
  imageUrl?: string;
  tags?: string[];
  symbols?: string[];
  publishedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface NewsSourceConfig {
  id: string;
  url: string;
  apiKey?: string;
  config?: {
    // Общие
    accounts?: string[];
    keywords?: string[];
    language?: string;
    maxAge?: number;
    // Для web_scraper
    newsListSelector?: string;
    articleLinkSelector?: string;
    titleSelector?: string;
    contentSelector?: string;
    dateSelector?: string;
    authorSelector?: string;
    imageSelector?: string;
    summarySelector?: string;
    watchInterval?: number;
    waitForSelector?: string;
    // Для telegram
    channelUsername?: string;
  };
}

export interface NewsParser {
  readonly sourceType: string;
  parse(source: NewsSourceConfig): Promise<ParsedArticle[]>;
  extractSymbols(text: string): string[];
}

export interface FetchProgress {
  sourceId: string;
  status: "pending" | "running" | "completed" | "failed";
  articlesFound: number;
  articlesSaved: number;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

// Realtime парсер интерфейс
export interface RealtimeNewsParser extends NewsParser {
  startWatching(
    source: NewsSourceConfig,
    onArticle: (article: ParsedArticle) => void
  ): Promise<void>;
  stopWatching(sourceId: string): Promise<void>;
  isWatching(sourceId: string): boolean;
}

// Статус realtime
export interface RealtimeStatus {
  isRunning: boolean;
  webScraperSources: number;
  telegramChannels: number;
  connectedClients: number;
  errors: Array<{ sourceId: string; error: string; timestamp: Date }>;
}

// WebSocket события
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

export interface WsSubscribeEvent {
  type: "subscribe:news";
  data: {
    categories?: string[];
    symbols?: string[];
    sourceIds?: string[];
  };
}

export type WsServerEvent = WsNewsArticleEvent | WsSourceStatusEvent;
export type WsClientEvent = WsSubscribeEvent | { type: "unsubscribe:news" };
