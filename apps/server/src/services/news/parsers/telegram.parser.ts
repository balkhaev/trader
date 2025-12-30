import { telegramClient } from "../realtime/telegram-client";
import type {
  NewsSourceConfig,
  ParsedArticle,
  RealtimeNewsParser,
} from "../types";

class TelegramParser implements RealtimeNewsParser {
  readonly sourceType = "telegram";

  private watchingSources: Map<string, string> = new Map(); // sourceId -> channelUsername

  isConfigured(): boolean {
    return telegramClient.isConfigured();
  }

  // Batch режим - получить последние сообщения (не реализовано для MTProto)
  async parse(_source: NewsSourceConfig): Promise<ParsedArticle[]> {
    // Для Telegram используем только realtime режим
    console.warn(
      "[TelegramParser] Batch mode not supported for Telegram. Use realtime mode."
    );
    return [];
  }

  // Realtime режим
  async startWatching(
    source: NewsSourceConfig,
    onArticle: (article: ParsedArticle) => void
  ): Promise<void> {
    const channelUsername = source.config?.channelUsername;
    if (!channelUsername) {
      throw new Error(`Source ${source.id} has no channelUsername configured`);
    }

    if (!telegramClient.isConfigured()) {
      throw new Error(
        "Telegram client not configured. Set TELEGRAM_API_ID and TELEGRAM_API_HASH"
      );
    }

    // Подключаемся если ещё не подключены
    if (!telegramClient.isConnected()) {
      await telegramClient.connect((article, srcId, _sourceName) => {
        // Находим callback для этого источника
        if (this.watchingSources.has(srcId)) {
          onArticle(article);
        }
      });
    }

    // Проверяем подключение после попытки connect
    if (!telegramClient.isConnected()) {
      // Тихо пропускаем - warning уже был показан в connect()
      return;
    }

    // Подписываемся на канал
    await telegramClient.subscribeToChannel(source.id, channelUsername);
    this.watchingSources.set(source.id, channelUsername);
  }

  async stopWatching(sourceId: string): Promise<void> {
    const channelUsername = this.watchingSources.get(sourceId);
    if (channelUsername) {
      await telegramClient.unsubscribeFromChannel(channelUsername);
      this.watchingSources.delete(sourceId);
    }
  }

  isWatching(sourceId: string): boolean {
    return this.watchingSources.has(sourceId);
  }

  async stopAllWatchers(): Promise<void> {
    for (const [_sourceId, channelUsername] of this.watchingSources) {
      await telegramClient.unsubscribeFromChannel(channelUsername);
    }
    this.watchingSources.clear();
    await telegramClient.disconnect();
  }

  getWatchingCount(): number {
    return this.watchingSources.size;
  }

  extractSymbols(text: string): string[] {
    const symbolPatterns = [
      /\bBTC\b/gi,
      /\bETH\b/gi,
      /\bBNB\b/gi,
      /\bXRP\b/gi,
      /\bADA\b/gi,
      /\bSOL\b/gi,
      /\$[A-Z]{2,10}\b/g,
    ];

    const found = new Set<string>();

    for (const pattern of symbolPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          found.add(match.replace("$", "").toUpperCase());
        }
      }
    }

    return [...found];
  }
}

export const telegramParser = new TelegramParser();
