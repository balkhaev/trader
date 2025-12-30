import { browserPool } from "../realtime/browser-pool";
import { PageWatcher } from "../realtime/page-watcher";
import type {
  NewsSourceConfig,
  ParsedArticle,
  RealtimeNewsParser,
} from "../types";

class WebScraperParser implements RealtimeNewsParser {
  readonly sourceType = "web_scraper";

  private watchers: Map<string, PageWatcher> = new Map();

  // Batch режим - для совместимости с существующим API
  async parse(source: NewsSourceConfig): Promise<ParsedArticle[]> {
    if (!source.config?.newsListSelector) {
      console.warn(
        `[WebScraperParser] Source ${source.id} has no newsListSelector`
      );
      return [];
    }

    const page = await browserPool.getPage();
    const articles: ParsedArticle[] = [];

    try {
      await page.goto(source.url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (source.config.waitForSelector) {
        await page
          .waitForSelector(source.config.waitForSelector, {
            timeout: 10_000,
          })
          .catch(() => {});
      }

      // Извлекаем ссылки на статьи
      const articleLinks = await page.$$eval(
        source.config.newsListSelector,
        (elements, config) => {
          return elements.slice(0, 20).map((el) => {
            const linkEl = config.articleLinkSelector
              ? el.querySelector(config.articleLinkSelector)
              : el.querySelector("a");

            const titleEl = config.titleSelector
              ? el.querySelector(config.titleSelector)
              : linkEl;

            return {
              url: linkEl?.getAttribute("href") || "",
              title: titleEl?.textContent?.trim() || "",
            };
          });
        },
        {
          articleLinkSelector: source.config.articleLinkSelector,
          titleSelector: source.config.titleSelector,
        }
      );

      // Нормализуем URL'ы
      const normalizedLinks = articleLinks
        .filter((a) => a.url && a.title)
        .map((a) => ({
          url: a.url.startsWith("http")
            ? a.url
            : new URL(a.url, source.url).toString(),
          title: a.title,
        }));

      // Парсим каждую статью
      for (const link of normalizedLinks.slice(0, 10)) {
        try {
          const articlePage = await browserPool.getPage();

          try {
            await articlePage.goto(link.url, {
              waitUntil: "domcontentloaded",
              timeout: 20_000,
            });

            const content = source.config.contentSelector
              ? await articlePage
                  .$eval(source.config.contentSelector, (el) =>
                    el.textContent?.trim()
                  )
                  .catch(() => null)
              : null;

            const author = source.config.authorSelector
              ? await articlePage
                  .$eval(source.config.authorSelector, (el) =>
                    el.textContent?.trim()
                  )
                  .catch(() => null)
              : null;

            const dateStr = source.config.dateSelector
              ? await articlePage
                  .$eval(
                    source.config.dateSelector,
                    (el) =>
                      el.getAttribute("datetime") || el.textContent?.trim()
                  )
                  .catch(() => null)
              : null;

            articles.push({
              externalId: Buffer.from(link.url).toString("base64").slice(0, 32),
              url: link.url,
              title: link.title,
              content: content || undefined,
              author: author || undefined,
              symbols: this.extractSymbols(`${link.title} ${content || ""}`),
              publishedAt: dateStr ? new Date(dateStr) : new Date(),
            });
          } finally {
            await browserPool.releasePage(articlePage);
          }
        } catch (error) {
          console.error(
            `[WebScraperParser] Error parsing article ${link.url}:`,
            error
          );
        }
      }
    } finally {
      await browserPool.releasePage(page);
    }

    return articles;
  }

  // Realtime режим
  async startWatching(
    source: NewsSourceConfig,
    onArticle: (article: ParsedArticle) => void
  ): Promise<void> {
    if (this.watchers.has(source.id)) {
      console.log(`[WebScraperParser] Already watching source ${source.id}`);
      return;
    }

    if (!source.config?.newsListSelector) {
      throw new Error(`Source ${source.id} has no newsListSelector configured`);
    }

    const watcher = new PageWatcher(
      source.id,
      `WebScraper:${source.id}`,
      source.url,
      source.config
    );

    this.watchers.set(source.id, watcher);
    await watcher.start(onArticle);
  }

  async stopWatching(sourceId: string): Promise<void> {
    const watcher = this.watchers.get(sourceId);
    if (watcher) {
      await watcher.stop();
      this.watchers.delete(sourceId);
    }
  }

  isWatching(sourceId: string): boolean {
    return this.watchers.get(sourceId)?.isWatching() ?? false;
  }

  async stopAllWatchers(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      await watcher.stop();
    }
    this.watchers.clear();
  }

  getWatchingCount(): number {
    return this.watchers.size;
  }

  extractSymbols(text: string): string[] {
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
      /\bAAVE\b/gi,
      /\bBitcoin\b/gi,
      /\bEthereum\b/gi,
      /\bSolana\b/gi,
      /\bCardano\b/gi,
      /\bPolkadot\b/gi,
      /\bAvalanche\b/gi,
      /\bChainlink\b/gi,
      /\bPolygon\b/gi,
    ];

    const symbolMap: Record<string, string> = {
      bitcoin: "BTC",
      ethereum: "ETH",
      solana: "SOL",
      cardano: "ADA",
      polkadot: "DOT",
      avalanche: "AVAX",
      chainlink: "LINK",
      polygon: "MATIC",
    };

    const found = new Set<string>();

    for (const pattern of symbolPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        for (const match of matches) {
          const normalized =
            symbolMap[match.toLowerCase()] || match.toUpperCase();
          found.add(normalized);
        }
      }
    }

    return [...found];
  }
}

export const webScraperParser = new WebScraperParser();
