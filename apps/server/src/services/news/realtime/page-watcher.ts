import { EventEmitter } from "node:events";
import type { Page } from "playwright";
import type { NewsSourceConfig, ParsedArticle } from "../types";
import { browserPool } from "./browser-pool";
import { newsEventEmitter } from "./event-emitter";

const DEFAULT_WATCH_INTERVAL = 10_000; // 10 секунд

interface ArticleLink {
  url: string;
  title: string;
}

export class PageWatcher extends EventEmitter {
  private page: Page | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private knownArticleUrls: Set<string> = new Set();
  private isRunning = false;
  private sourceId: string;
  private sourceName: string;
  private url: string;
  private config: NonNullable<NewsSourceConfig["config"]>;
  private onArticleCallback: ((article: ParsedArticle) => void) | null = null;

  constructor(
    sourceId: string,
    sourceName: string,
    url: string,
    config: NonNullable<NewsSourceConfig["config"]>
  ) {
    super();
    this.sourceId = sourceId;
    this.sourceName = sourceName;
    this.url = url;
    this.config = config;
  }

  async start(onArticle: (article: ParsedArticle) => void): Promise<void> {
    if (this.isRunning) {
      console.log(`[PageWatcher:${this.sourceName}] Already running`);
      return;
    }

    this.onArticleCallback = onArticle;

    try {
      this.page = await browserPool.getPage();
      console.log(`[PageWatcher:${this.sourceName}] Navigating to ${this.url}`);

      await this.page.goto(this.url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      // Ждём появления элементов если указан селектор
      if (this.config.waitForSelector) {
        await this.page.waitForSelector(this.config.waitForSelector, {
          timeout: 10_000,
        });
      }

      // Первичное сканирование - запоминаем существующие статьи
      const initialArticles = await this.extractArticleLinks();
      for (const article of initialArticles) {
        this.knownArticleUrls.add(article.url);
      }

      console.log(
        `[PageWatcher:${this.sourceName}] Found ${initialArticles.length} existing articles`
      );

      this.isRunning = true;
      newsEventEmitter.emitSourceConnected(this.sourceId, this.sourceName);

      // Запускаем периодическую проверку
      const interval = this.config.watchInterval ?? DEFAULT_WATCH_INTERVAL;
      this.intervalId = setInterval(() => {
        this.checkForNewArticles().catch((error) => {
          console.error(`[PageWatcher:${this.sourceName}] Check error:`, error);
        });
      }, interval);

      console.log(
        `[PageWatcher:${this.sourceName}] Started watching (interval: ${interval}ms)`
      );
    } catch (error) {
      console.error(`[PageWatcher:${this.sourceName}] Failed to start:`, error);
      newsEventEmitter.emitSourceError(
        this.sourceId,
        this.sourceName,
        error instanceof Error ? error : new Error(String(error))
      );
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log(`[PageWatcher:${this.sourceName}] Stopping...`);

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.page) {
      await browserPool.releasePage(this.page);
      this.page = null;
    }

    if (this.isRunning) {
      newsEventEmitter.emitSourceDisconnected(this.sourceId, this.sourceName);
    }

    this.isRunning = false;
    this.onArticleCallback = null;
    console.log(`[PageWatcher:${this.sourceName}] Stopped`);
  }

  isWatching(): boolean {
    return this.isRunning;
  }

  private async checkForNewArticles(): Promise<void> {
    if (!(this.page && this.isRunning)) return;

    try {
      // Перезагружаем страницу для получения свежих данных
      await this.page.reload({
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (this.config.waitForSelector) {
        await this.page
          .waitForSelector(this.config.waitForSelector, {
            timeout: 10_000,
          })
          .catch(() => {});
      }

      const currentArticles = await this.extractArticleLinks();
      const newArticles = currentArticles.filter(
        (a) => !this.knownArticleUrls.has(a.url)
      );

      if (newArticles.length > 0) {
        console.log(
          `[PageWatcher:${this.sourceName}] Found ${newArticles.length} new articles`
        );

        for (const articleLink of newArticles) {
          this.knownArticleUrls.add(articleLink.url);

          // Парсим полную статью
          const fullArticle = await this.parseFullArticle(articleLink);
          if (fullArticle && this.onArticleCallback) {
            this.onArticleCallback(fullArticle);
            newsEventEmitter.emitArticleNew(
              fullArticle,
              this.sourceId,
              this.sourceName
            );
          }
        }
      }
    } catch (error) {
      console.error(
        `[PageWatcher:${this.sourceName}] Error checking for new articles:`,
        error
      );
    }
  }

  private async extractArticleLinks(): Promise<ArticleLink[]> {
    if (!this.page) return [];

    const { newsListSelector, articleLinkSelector, titleSelector } =
      this.config;

    if (!newsListSelector) {
      console.warn(
        `[PageWatcher:${this.sourceName}] No newsListSelector configured`
      );
      return [];
    }

    try {
      const articles = await this.page.$$eval(
        newsListSelector,
        (elements, selectors) => {
          return elements.map((el) => {
            // Получаем ссылку
            const linkEl = selectors.articleLinkSelector
              ? el.querySelector(selectors.articleLinkSelector)
              : el.querySelector("a");

            const href = linkEl?.getAttribute("href") || "";

            // Получаем заголовок
            const titleEl = selectors.titleSelector
              ? el.querySelector(selectors.titleSelector)
              : linkEl;

            const title = titleEl?.textContent?.trim() || "";

            return { url: href, title };
          });
        },
        { articleLinkSelector, titleSelector }
      );

      // Нормализуем URL'ы и фильтруем пустые
      return articles
        .filter((a) => a.url && a.title)
        .map((a) => ({
          url: a.url.startsWith("http")
            ? a.url
            : new URL(a.url, this.url).toString(),
          title: a.title,
        }));
    } catch (error) {
      console.error(
        `[PageWatcher:${this.sourceName}] Error extracting article links:`,
        error
      );
      return [];
    }
  }

  private async parseFullArticle(
    articleLink: ArticleLink
  ): Promise<ParsedArticle | null> {
    if (!this.page) return null;

    try {
      // Открываем страницу статьи в новой вкладке
      const articlePage = await browserPool.getPage();

      try {
        await articlePage.goto(articleLink.url, {
          waitUntil: "domcontentloaded",
          timeout: 20_000,
        });

        // Извлекаем данные
        const content = this.config.contentSelector
          ? await articlePage
              .$eval(this.config.contentSelector, (el) =>
                el.textContent?.trim()
              )
              .catch(() => null)
          : null;

        const author = this.config.authorSelector
          ? await articlePage
              .$eval(this.config.authorSelector, (el) => el.textContent?.trim())
              .catch(() => null)
          : null;

        const dateStr = this.config.dateSelector
          ? await articlePage
              .$eval(
                this.config.dateSelector,
                (el) => el.getAttribute("datetime") || el.textContent?.trim()
              )
              .catch(() => null)
          : null;

        const imageUrl = this.config.imageSelector
          ? await articlePage
              .$eval(
                this.config.imageSelector,
                (el) =>
                  el.getAttribute("src") || el.getAttribute("data-src") || null
              )
              .catch(() => null)
          : null;

        const summary = this.config.summarySelector
          ? await articlePage
              .$eval(this.config.summarySelector, (el) =>
                el.textContent?.trim()
              )
              .catch(() => null)
          : null;

        // Извлекаем символы из контента
        const symbols = this.extractSymbols(
          `${articleLink.title} ${content || ""}`
        );

        const article: ParsedArticle = {
          externalId: this.generateExternalId(articleLink.url),
          url: articleLink.url,
          title: articleLink.title,
          content: content || undefined,
          summary: summary || undefined,
          author: author || undefined,
          imageUrl: imageUrl || undefined,
          symbols: symbols.length > 0 ? symbols : undefined,
          publishedAt: dateStr ? new Date(dateStr) : new Date(),
        };

        return article;
      } finally {
        await browserPool.releasePage(articlePage);
      }
    } catch (error) {
      console.error(
        `[PageWatcher:${this.sourceName}] Error parsing article ${articleLink.url}:`,
        error
      );
      return null;
    }
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
      /\bAAVE\b/gi,
      /\bCRV\b/gi,
      /\bMKR\b/gi,
      /\bSUSHI\b/gi,
      /\bCOMP\b/gi,
      /\bYFI\b/gi,
      /\bSNX\b/gi,
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

  private generateExternalId(url: string): string {
    // Генерируем ID на основе URL
    return Buffer.from(url).toString("base64").slice(0, 32);
  }
}
