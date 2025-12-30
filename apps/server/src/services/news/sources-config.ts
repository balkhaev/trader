// Предустановленные источники новостей
export const PRESET_SOURCES = {
  // === Крипто новости ===
  coindesk: {
    name: "CoinDesk",
    type: "web_scraper" as const,
    url: "https://www.coindesk.com/",
    category: "crypto" as const,
    config: {
      newsListSelector: '[data-testid="simple-story-card"]',
      articleLinkSelector: "a",
      titleSelector: "h4, h3",
      contentSelector: "article",
      dateSelector: "time",
      watchInterval: 15_000,
    },
  },
  cointelegraph: {
    name: "CoinTelegraph",
    type: "web_scraper" as const,
    url: "https://cointelegraph.com/",
    category: "crypto" as const,
    config: {
      newsListSelector: ".post-card",
      articleLinkSelector: ".post-card__title-link",
      titleSelector: ".post-card__title",
      contentSelector: "article",
      watchInterval: 15_000,
    },
  },
  theblock: {
    name: "The Block",
    type: "web_scraper" as const,
    url: "https://www.theblock.co/latest",
    category: "crypto" as const,
    config: {
      newsListSelector: "article",
      articleLinkSelector: "a",
      titleSelector: "h2, h3",
      contentSelector: "article",
      watchInterval: 20_000,
    },
  },
  decrypt: {
    name: "Decrypt",
    type: "web_scraper" as const,
    url: "https://decrypt.co/news",
    category: "crypto" as const,
    config: {
      newsListSelector: ".post-card, article",
      articleLinkSelector: "a",
      titleSelector: "h3, h2",
      contentSelector: "article",
      watchInterval: 15_000,
    },
  },

  // === Финансовые новости ===
  bloomberg_crypto: {
    name: "Bloomberg Crypto",
    type: "web_scraper" as const,
    url: "https://www.bloomberg.com/crypto",
    category: "crypto" as const,
    config: {
      newsListSelector: "article",
      articleLinkSelector: "a",
      titleSelector: "h3",
      contentSelector: "article",
      watchInterval: 30_000, // Bloomberg имеет rate limiting
    },
  },
  reuters_markets: {
    name: "Reuters Markets",
    type: "web_scraper" as const,
    url: "https://www.reuters.com/markets/",
    category: "macro" as const,
    config: {
      newsListSelector: '[data-testid="MediaStoryCard"]',
      articleLinkSelector: "a",
      titleSelector: "h3",
      contentSelector: "article",
      watchInterval: 25_000,
    },
  },
  cnbc_crypto: {
    name: "CNBC Crypto",
    type: "web_scraper" as const,
    url: "https://www.cnbc.com/cryptoworld/",
    category: "crypto" as const,
    config: {
      newsListSelector: ".Card-titleContainer",
      articleLinkSelector: "a",
      titleSelector: ".Card-title",
      contentSelector: "article",
      watchInterval: 25_000,
    },
  },

  // === Telegram каналы ===
  wu_blockchain: {
    name: "Wu Blockchain",
    type: "telegram" as const,
    url: "https://t.me/wublockchainenglish",
    category: "crypto" as const,
    config: {
      channelUsername: "wublockchainenglish",
    },
  },
  whale_alert: {
    name: "Whale Alert",
    type: "telegram" as const,
    url: "https://t.me/whale_alert_io",
    category: "crypto" as const,
    config: {
      channelUsername: "whale_alert_io",
    },
  },
  crypto_breaking: {
    name: "Crypto Breaking News",
    type: "telegram" as const,
    url: "https://t.me/CryptoComOfficial",
    category: "crypto" as const,
    config: {
      channelUsername: "CryptoComOfficial",
    },
  },
  markettwits: {
    name: "MarketTwits",
    type: "telegram" as const,
    url: "https://t.me/markettwits",
    category: "macro" as const,
    config: {
      channelUsername: "markettwits",
    },
  },
} as const;

export type PresetSourceKey = keyof typeof PRESET_SOURCES;

export function getPresetSource(key: PresetSourceKey) {
  return PRESET_SOURCES[key];
}

export function getAllPresets() {
  return Object.entries(PRESET_SOURCES).map(([key, value]) => ({
    key,
    ...value,
  }));
}

export function getPresetsByType(type: "web_scraper" | "telegram") {
  return Object.entries(PRESET_SOURCES)
    .filter(([_, value]) => value.type === type)
    .map(([key, value]) => ({ key, ...value }));
}
