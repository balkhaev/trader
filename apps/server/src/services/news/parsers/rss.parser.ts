import type { NewsParser, NewsSourceConfig, ParsedArticle } from "../types";

// Регекс для поиска криптовалютных тикеров
const CRYPTO_SYMBOLS_REGEX =
  /\b(BTC|ETH|SOL|XRP|ADA|DOGE|DOT|MATIC|LINK|AVAX|ATOM|LTC|UNI|AAVE|CRV|MKR|SNX|COMP|YFI|SUSHI|APE|SHIB|ARB|OP|SUI|SEI|TIA|JUP|PEPE|WIF|BONK)\b/gi;

interface RssItem {
  guid?: string;
  link?: string;
  title?: string;
  content?: string;
  "content:encoded"?: string;
  contentSnippet?: string;
  description?: string;
  creator?: string;
  author?: string;
  pubDate?: string;
  categories?: string[];
  enclosure?: { url?: string };
  "media:content"?: { url?: string };
}

interface RssFeed {
  title?: string;
  description?: string;
  items: RssItem[];
}

export class RssParser implements NewsParser {
  readonly sourceType = "rss";

  async parse(source: NewsSourceConfig): Promise<ParsedArticle[]> {
    const response = await fetch(source.url, {
      headers: {
        "User-Agent": "TraderBot/1.0 (RSS Reader)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch RSS: ${response.status}`);
    }

    const text = await response.text();
    const feed = this.parseXml(text);

    return feed.items.map((item) => ({
      externalId: item.guid || item.link || "",
      url: item.link || "",
      title: item.title || "",
      content: item.content || item["content:encoded"] || "",
      summary: item.contentSnippet || item.description || "",
      author: item.creator || item.author,
      imageUrl: this.extractImage(item),
      tags: item.categories || [],
      symbols: this.extractSymbols(
        `${item.title || ""} ${item.content || item.description || ""}`
      ),
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      metadata: {
        feedTitle: feed.title,
        feedDescription: feed.description,
      },
    }));
  }

  extractSymbols(text: string): string[] {
    const matches = text.match(CRYPTO_SYMBOLS_REGEX);
    return [...new Set(matches?.map((s) => s.toUpperCase()) || [])];
  }

  private parseXml(xml: string): RssFeed {
    const items: RssItem[] = [];

    // Извлекаем title канала
    const channelTitleMatch = xml.match(
      /<channel>[\s\S]*?<title>([^<]*)<\/title>/
    );
    const feedTitle = channelTitleMatch?.[1] || "";

    // Извлекаем description канала
    const channelDescMatch = xml.match(
      /<channel>[\s\S]*?<description>([^<]*)<\/description>/
    );
    const feedDescription = channelDescMatch?.[1] || "";

    // Парсим items
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const itemXml = match[1];
      if (!itemXml) continue;

      const item: RssItem = {
        guid: this.extractTag(itemXml, "guid"),
        link: this.extractTag(itemXml, "link"),
        title: this.decodeHtml(this.extractTag(itemXml, "title") || ""),
        description: this.decodeHtml(
          this.extractTag(itemXml, "description") || ""
        ),
        content: this.extractCdata(itemXml, "content:encoded"),
        pubDate: this.extractTag(itemXml, "pubDate"),
        creator: this.extractTag(itemXml, "dc:creator"),
        author: this.extractTag(itemXml, "author"),
        categories: this.extractCategories(itemXml),
      };

      // Извлекаем enclosure для изображений
      const enclosureMatch = itemXml.match(/<enclosure[^>]+url="([^"]+)"/);
      if (enclosureMatch) {
        item.enclosure = { url: enclosureMatch[1] };
      }

      items.push(item);
    }

    return {
      title: feedTitle,
      description: feedDescription,
      items,
    };
  }

  private extractTag(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
    const match = xml.match(regex);
    return match?.[1]?.trim();
  }

  private extractCdata(xml: string, tag: string): string | undefined {
    const regex = new RegExp(
      `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`,
      "i"
    );
    const match = xml.match(regex);
    return match?.[1]?.trim();
  }

  private extractCategories(xml: string): string[] {
    const categories: string[] = [];
    const matches = xml.matchAll(/<category[^>]*>([^<]*)<\/category>/gi);
    for (const match of matches) {
      if (match[1]) {
        categories.push(match[1].trim());
      }
    }
    return categories;
  }

  private extractImage(item: RssItem): string | undefined {
    if (item.enclosure?.url) return item.enclosure.url;

    // Извлечь из content
    const content = item.content || item["content:encoded"] || "";
    const imgMatch = content.match(/<img[^>]+src="([^"]+)"/);
    return imgMatch?.[1];
  }

  private decodeHtml(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
}
