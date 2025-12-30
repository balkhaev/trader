import { env } from "@trader/env/server";
import { type Browser, chromium, type Page } from "playwright";

interface BrowserPoolConfig {
  maxBrowsers: number;
  maxPagesPerBrowser: number;
  headless: boolean;
}

interface BrowserInfo {
  browser: Browser;
  pageCount: number;
}

class BrowserPool {
  private browsers: BrowserInfo[] = [];
  private config: BrowserPoolConfig;
  private initialized = false;

  constructor(config?: Partial<BrowserPoolConfig>) {
    this.config = {
      maxBrowsers: config?.maxBrowsers ?? env.PLAYWRIGHT_MAX_BROWSERS ?? 3,
      maxPagesPerBrowser: config?.maxPagesPerBrowser ?? 5,
      headless: config?.headless ?? env.PLAYWRIGHT_HEADLESS ?? true,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    console.log("[BrowserPool] Initialized with config:", this.config);
  }

  async getPage(): Promise<Page> {
    await this.initialize();

    // Найти браузер с доступными слотами
    let browserInfo = this.browsers.find(
      (b) => b.pageCount < this.config.maxPagesPerBrowser
    );

    // Создать новый браузер если нужно
    if (!browserInfo && this.browsers.length < this.config.maxBrowsers) {
      const browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      browserInfo = { browser, pageCount: 0 };
      this.browsers.push(browserInfo);
      console.log(
        `[BrowserPool] Created new browser (${this.browsers.length}/${this.config.maxBrowsers})`
      );
    }

    if (!browserInfo) {
      // Ждём освобождения слота
      console.log("[BrowserPool] Waiting for available browser slot...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return this.getPage();
    }

    const page = await browserInfo.browser.newPage();
    browserInfo.pageCount++;

    // Базовые настройки страницы
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setExtraHTTPHeaders({
      "Accept-Language": "en-US,en;q=0.9",
    });

    // Блокируем лишние ресурсы для ускорения
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "font", "media", "stylesheet"].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    return page;
  }

  async releasePage(page: Page): Promise<void> {
    const browserInfo = this.browsers.find(
      (b) => b.browser === page.context().browser()
    );

    if (browserInfo) {
      browserInfo.pageCount--;
    }

    try {
      await page.close();
    } catch {
      // Page already closed
    }
  }

  async cleanup(): Promise<void> {
    console.log("[BrowserPool] Cleaning up...");

    for (const browserInfo of this.browsers) {
      try {
        await browserInfo.browser.close();
      } catch (error) {
        console.error("[BrowserPool] Error closing browser:", error);
      }
    }

    this.browsers = [];
    this.initialized = false;
    console.log("[BrowserPool] Cleanup complete");
  }

  getStats(): {
    browsers: number;
    maxBrowsers: number;
    totalPages: number;
    maxPages: number;
  } {
    const totalPages = this.browsers.reduce((sum, b) => sum + b.pageCount, 0);
    return {
      browsers: this.browsers.length,
      maxBrowsers: this.config.maxBrowsers,
      totalPages,
      maxPages: this.config.maxBrowsers * this.config.maxPagesPerBrowser,
    };
  }
}

export const browserPool = new BrowserPool();
