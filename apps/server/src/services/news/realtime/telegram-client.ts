import { EventEmitter } from "node:events";
import { env } from "@trader/env/server";
import type { Api } from "telegram";
import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events";
import { StringSession } from "telegram/sessions";
import type { ParsedArticle } from "../types";
import { newsEventEmitter } from "./event-emitter";

interface ChannelSubscription {
  sourceId: string;
  channelUsername: string;
  entityId?: bigint;
}

class TelegramNewsClient extends EventEmitter {
  private client: TelegramClient | null = null;
  private session: StringSession;
  private subscriptions: Map<string, ChannelSubscription> = new Map();
  private connected = false;
  private sessionWarningShown = false;
  private onArticleCallback:
    | ((article: ParsedArticle, sourceId: string, sourceName: string) => void)
    | null = null;

  constructor() {
    super();
    this.session = new StringSession(env.TELEGRAM_SESSION_STRING || "");
  }

  isConfigured(): boolean {
    return !!(env.TELEGRAM_API_ID && env.TELEGRAM_API_HASH);
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(
    onArticle: (
      article: ParsedArticle,
      sourceId: string,
      sourceName: string
    ) => void
  ): Promise<void> {
    if (!this.isConfigured()) {
      console.log(
        "[TelegramClient] Not configured (missing API_ID or API_HASH)"
      );
      return;
    }

    if (this.connected) {
      console.log("[TelegramClient] Already connected");
      return;
    }

    // Если нет сохраненной сессии, нужна интерактивная авторизация
    if (!env.TELEGRAM_SESSION_STRING) {
      if (!this.sessionWarningShown) {
        console.warn(
          "[TelegramClient] No session string. Run: bun run telegram:auth"
        );
        this.sessionWarningShown = true;
      }
      return;
    }

    this.onArticleCallback = onArticle;

    try {
      this.client = new TelegramClient(
        this.session,
        env.TELEGRAM_API_ID!,
        env.TELEGRAM_API_HASH!,
        {
          connectionRetries: 5,
          useWSS: true,
        }
      );

      await this.client.connect();
      this.connected = true;

      // Добавляем обработчик новых сообщений
      this.client.addEventHandler(
        (event) => this.handleNewMessage(event),
        new NewMessage({})
      );

      console.log("[TelegramClient] Connected successfully");

      // Сохраняем сессию (если изменилась)
      const sessionString = this.session.save();
      if (sessionString !== env.TELEGRAM_SESSION_STRING) {
        console.log("[TelegramClient] New session string:", sessionString);
        console.log("[TelegramClient] Update TELEGRAM_SESSION_STRING in .env");
      }
    } catch (error) {
      console.error("[TelegramClient] Connection error:", error);
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
    this.connected = false;
    this.subscriptions.clear();
    this.onArticleCallback = null;
    console.log("[TelegramClient] Disconnected");
  }

  async subscribeToChannel(
    sourceId: string,
    channelUsername: string
  ): Promise<void> {
    if (!(this.client && this.connected)) {
      throw new Error("Telegram client not connected");
    }

    // Удаляем @ если есть
    const username = channelUsername.replace(/^@/, "");

    if (this.subscriptions.has(username)) {
      console.log(`[TelegramClient] Already subscribed to ${username}`);
      return;
    }

    try {
      // Получаем entity канала для проверки
      const entity = await this.client.getEntity(username);

      this.subscriptions.set(username, {
        sourceId,
        channelUsername: username,
        entityId: BigInt(entity.id.toString()),
      });

      newsEventEmitter.emitSourceConnected(sourceId, `Telegram:${username}`);
      console.log(`[TelegramClient] Subscribed to channel: ${username}`);
    } catch (error) {
      console.error(
        `[TelegramClient] Failed to subscribe to ${username}:`,
        error
      );
      newsEventEmitter.emitSourceError(
        sourceId,
        `Telegram:${username}`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  async unsubscribeFromChannel(channelUsername: string): Promise<void> {
    const username = channelUsername.replace(/^@/, "");
    const subscription = this.subscriptions.get(username);

    if (subscription) {
      this.subscriptions.delete(username);
      newsEventEmitter.emitSourceDisconnected(
        subscription.sourceId,
        `Telegram:${username}`
      );
      console.log(`[TelegramClient] Unsubscribed from channel: ${username}`);
    }
  }

  getSubscribedChannels(): string[] {
    return [...this.subscriptions.keys()];
  }

  private handleNewMessage(event: { message: Api.Message }): void {
    const message = event.message;

    // Проверяем, что сообщение из подписанного канала
    const chatId = message.peerId;
    if (!chatId) return;

    // Ищем подписку по ID
    let subscription: ChannelSubscription | undefined;
    for (const sub of this.subscriptions.values()) {
      if (sub.entityId && chatId.toString().includes(sub.entityId.toString())) {
        subscription = sub;
        break;
      }
    }

    if (!subscription) return;

    // Преобразуем сообщение в статью
    const article = this.messageToArticle(message, subscription);

    if (article && this.onArticleCallback) {
      this.onArticleCallback(
        article,
        subscription.sourceId,
        `Telegram:${subscription.channelUsername}`
      );
      newsEventEmitter.emitArticleNew(
        article,
        subscription.sourceId,
        `Telegram:${subscription.channelUsername}`
      );
    }
  }

  private messageToArticle(
    message: Api.Message,
    subscription: ChannelSubscription
  ): ParsedArticle | null {
    const text = message.message || "";
    if (!text.trim()) return null;

    // Извлекаем заголовок (первая строка или первые 100 символов)
    const lines = text.split("\n").filter((l) => l.trim());
    const title = lines[0]?.slice(0, 200) || text.slice(0, 200);
    const content = text;

    // Извлекаем URL'ы из сообщения
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    const url = urlMatch
      ? urlMatch[0]
      : `https://t.me/${subscription.channelUsername}/${message.id}`;

    // Извлекаем символы
    const symbols = this.extractSymbols(text);

    return {
      externalId: `tg_${subscription.channelUsername}_${message.id}`,
      url,
      title,
      content,
      symbols: symbols.length > 0 ? symbols : undefined,
      publishedAt: new Date(message.date * 1000),
      metadata: {
        telegramMessageId: message.id,
        telegramChannel: subscription.channelUsername,
      },
    };
  }

  private extractSymbols(text: string): string[] {
    const symbolPatterns = [
      /\bBTC\b/gi,
      /\bETH\b/gi,
      /\bBNB\b/gi,
      /\bXRP\b/gi,
      /\bADA\b/gi,
      /\bDOGE\b/gi,
      /\bSOL\b/gi,
      /\bDOT\b/gi,
      /\bMATIC\b/gi,
      /\bAVAX\b/gi,
      /\bLINK\b/gi,
      /\bATOM\b/gi,
      /\bUNI\b/gi,
      /\$[A-Z]{2,10}\b/g, // $BTC, $ETH и т.д.
    ];

    const symbolMap: Record<string, string> = {
      bitcoin: "BTC",
      ethereum: "ETH",
      solana: "SOL",
    };

    const found = new Set<string>();

    for (const pattern of symbolPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const cleaned = match.replace("$", "").toUpperCase();
          const normalized = symbolMap[cleaned.toLowerCase()] || cleaned;
          found.add(normalized);
        }
      }
    }

    return [...found];
  }
}

export const telegramClient = new TelegramNewsClient();
