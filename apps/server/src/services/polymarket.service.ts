import { db, polymarketEvent, polymarketMarket } from "@trader/db";
import { and, desc, eq, gte, like, or, sql } from "drizzle-orm";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

interface GammaTag {
  id: string;
  slug: string;
  label?: string;
}

interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  endDate: string;
  startDate?: string;
  image?: string;
  description?: string;
  outcomes: string;
  outcomePrices: string;
  volume: string;
  volume24hr?: string;
  liquidity: string;
  bestBid?: string;
  bestAsk?: string;
  lastTradePrice?: string;
  spread?: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string;
}

interface GammaEvent {
  id: string;
  ticker?: string;
  slug: string;
  title: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  image?: string;
  active: boolean;
  closed: boolean;
  liquidity?: string;
  volume?: string;
  volume24hr?: string;
  openInterest?: string;
  tags?: GammaTag[];
  markets?: GammaMarket[];
}

interface FetchEventsParams {
  limit?: number;
  offset?: number;
  closed?: boolean;
  active?: boolean;
  tag?: string;
  slug?: string;
}

export interface SyncProgress {
  id: string;
  status: "running" | "completed" | "failed";
  totalFetched: number;
  savedEvents: number;
  savedMarkets: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

const runningSyncs = new Map<string, SyncProgress>();

function parseJsonArray(value: string | undefined): string[] | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as string[];
  } catch {
    return null;
  }
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

export const polymarketService = {
  async fetchEvents(params: FetchEventsParams = {}): Promise<GammaEvent[]> {
    const searchParams = new URLSearchParams();

    searchParams.set("limit", String(params.limit ?? 100));
    searchParams.set("offset", String(params.offset ?? 0));
    searchParams.set("order", "volume");
    searchParams.set("ascending", "false");

    if (params.closed !== undefined) {
      searchParams.set("closed", String(params.closed));
    }
    if (params.active !== undefined) {
      searchParams.set("active", String(params.active));
    }
    if (params.tag) {
      searchParams.set("tag", params.tag);
    }
    if (params.slug) {
      searchParams.set("slug", params.slug);
    }

    const url = `${GAMMA_API_BASE}/events?${searchParams}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Gamma API error: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as GammaEvent[];
  },

  async fetchTags(): Promise<GammaTag[]> {
    const url = `${GAMMA_API_BASE}/tags`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Gamma API error: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as GammaTag[];
  },

  async searchEvents(query: string): Promise<GammaEvent[]> {
    const url = `${GAMMA_API_BASE}/events?title_contains=${encodeURIComponent(query)}&limit=50`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Gamma API error: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as GammaEvent[];
  },

  async saveEvent(event: GammaEvent): Promise<void> {
    const eventData = {
      id: event.id,
      ticker: event.ticker ?? null,
      slug: event.slug,
      title: event.title,
      description: event.description ?? null,
      startDate: event.startDate ? new Date(event.startDate) : null,
      endDate: event.endDate ? new Date(event.endDate) : null,
      image: event.image ?? null,
      active: event.active,
      closed: event.closed,
      liquidity: parseNumber(event.liquidity),
      volume: parseNumber(event.volume),
      volume24hr: parseNumber(event.volume24hr),
      openInterest: parseNumber(event.openInterest),
      tags:
        event.tags?.map((t) => ({
          id: t.id,
          slug: t.slug,
          label: t.label ?? t.slug,
        })) ?? null,
    };

    await db
      .insert(polymarketEvent)
      .values(eventData)
      .onConflictDoUpdate({
        target: polymarketEvent.id,
        set: {
          ...eventData,
          updatedAt: new Date(),
        },
      });

    if (event.markets) {
      for (const market of event.markets) {
        const marketData = {
          id: market.id,
          eventId: event.id,
          question: market.question,
          slug: market.slug ?? null,
          description: market.description ?? null,
          outcomes: parseJsonArray(market.outcomes),
          outcomePrices: parseJsonArray(market.outcomePrices),
          volume: parseNumber(market.volume),
          volume24hr: parseNumber(market.volume24hr),
          liquidity: parseNumber(market.liquidity),
          bestBid: parseNumber(market.bestBid),
          bestAsk: parseNumber(market.bestAsk),
          lastTradePrice: parseNumber(market.lastTradePrice),
          spread: parseNumber(market.spread),
          active: market.active,
          closed: market.closed,
          conditionId: market.conditionId ?? null,
          clobTokenIds: parseJsonArray(market.clobTokenIds),
        };

        await db
          .insert(polymarketMarket)
          .values(marketData)
          .onConflictDoUpdate({
            target: polymarketMarket.id,
            set: {
              ...marketData,
              updatedAt: new Date(),
            },
          });
      }
    }
  },

  async syncEvents(params: FetchEventsParams = {}): Promise<string> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const progress: SyncProgress = {
      id,
      status: "running",
      totalFetched: 0,
      savedEvents: 0,
      savedMarkets: 0,
      startedAt: new Date(),
    };

    runningSyncs.set(id, progress);

    this.runSync(id, params).catch((error) => {
      const p = runningSyncs.get(id);
      if (p) {
        p.status = "failed";
        p.error = error instanceof Error ? error.message : String(error);
        p.completedAt = new Date();
      }
    });

    return id;
  },

  async runSync(id: string, params: FetchEventsParams): Promise<void> {
    const progress = runningSyncs.get(id);
    if (!progress) return;

    try {
      const limit = params.limit ?? 100;
      let offset = params.offset ?? 0;
      let hasMore = true;

      while (hasMore) {
        const events = await this.fetchEvents({ ...params, limit, offset });

        if (events.length === 0) {
          hasMore = false;
          break;
        }

        progress.totalFetched += events.length;

        for (const event of events) {
          await this.saveEvent(event);
          progress.savedEvents++;
          progress.savedMarkets += event.markets?.length ?? 0;
        }

        offset += limit;

        // Задержка для избежания rate limiting
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      progress.status = "completed";
      progress.completedAt = new Date();
    } catch (error) {
      progress.status = "failed";
      progress.error = error instanceof Error ? error.message : String(error);
      progress.completedAt = new Date();
      throw error;
    }
  },

  getSyncProgress(id: string): SyncProgress | undefined {
    return runningSyncs.get(id);
  },

  async getStoredEvents(params: {
    limit?: number;
    offset?: number;
    active?: boolean;
    closed?: boolean;
    tag?: string;
    search?: string;
    minVolume?: number;
  }) {
    const conditions = [];

    if (params.active !== undefined) {
      conditions.push(eq(polymarketEvent.active, params.active));
    }
    if (params.closed !== undefined) {
      conditions.push(eq(polymarketEvent.closed, params.closed));
    }
    if (params.minVolume !== undefined) {
      conditions.push(gte(polymarketEvent.volume, params.minVolume));
    }
    if (params.search) {
      conditions.push(
        or(
          like(polymarketEvent.title, `%${params.search}%`),
          like(polymarketEvent.description, `%${params.search}%`)
        )
      );
    }
    if (params.tag) {
      conditions.push(
        sql`${polymarketEvent.tags}::jsonb @> ${JSON.stringify([{ slug: params.tag }])}::jsonb`
      );
    }

    const events = await db
      .select()
      .from(polymarketEvent)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(polymarketEvent.volume))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);

    return events;
  },

  async getStoredEventWithMarkets(eventId: string) {
    const event = await db
      .select()
      .from(polymarketEvent)
      .where(eq(polymarketEvent.id, eventId))
      .limit(1);

    if (event.length === 0) {
      return null;
    }

    const markets = await db
      .select()
      .from(polymarketMarket)
      .where(eq(polymarketMarket.eventId, eventId))
      .orderBy(desc(polymarketMarket.volume));

    return {
      ...event[0],
      markets,
    };
  },

  async getFinanceEvents(params: { limit?: number; offset?: number } = {}) {
    const financeTags = [
      "crypto",
      "finance",
      "economics",
      "stocks",
      "bitcoin",
      "ethereum",
    ];

    const events = await db
      .select()
      .from(polymarketEvent)
      .where(
        and(
          eq(polymarketEvent.active, true),
          eq(polymarketEvent.closed, false),
          or(
            ...financeTags.map(
              (tag) =>
                sql`${polymarketEvent.tags}::jsonb @> ${JSON.stringify([{ slug: tag }])}::jsonb`
            )
          )
        )
      )
      .orderBy(desc(polymarketEvent.volume))
      .limit(params.limit ?? 50)
      .offset(params.offset ?? 0);

    return events;
  },

  async getStats() {
    const [eventCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(polymarketEvent);

    const [marketCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(polymarketMarket);

    const [activeEventCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(polymarketEvent)
      .where(
        and(eq(polymarketEvent.active, true), eq(polymarketEvent.closed, false))
      );

    const [totalVolume] = await db
      .select({ total: sql<number>`sum(volume)` })
      .from(polymarketEvent);

    return {
      totalEvents: Number(eventCount?.count ?? 0),
      totalMarkets: Number(marketCount?.count ?? 0),
      activeEvents: Number(activeEventCount?.count ?? 0),
      totalVolume: Number(totalVolume?.total ?? 0),
    };
  },

  async getPriceHistory(
    tokenId: string,
    interval: "1h" | "6h" | "1d" | "max" = "1d"
  ): Promise<{ t: number; p: number }[]> {
    const url = `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=${interval}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`CLOB API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      history: { t: number; p: number }[];
    };
    return data.history ?? [];
  },

  async getMarketWithTokenId(marketId: string) {
    const market = await db
      .select()
      .from(polymarketMarket)
      .where(eq(polymarketMarket.id, marketId))
      .limit(1);

    return market[0] ?? null;
  },

  async getOpportunities(params: { limit?: number } = {}) {
    const markets = await db
      .select({
        market: polymarketMarket,
        event: polymarketEvent,
      })
      .from(polymarketMarket)
      .innerJoin(
        polymarketEvent,
        eq(polymarketMarket.eventId, polymarketEvent.id)
      )
      .where(
        and(
          eq(polymarketMarket.active, true),
          eq(polymarketMarket.closed, false),
          eq(polymarketEvent.active, true),
          eq(polymarketEvent.closed, false),
          gte(polymarketMarket.volume24hr, 1000),
          gte(polymarketMarket.liquidity, 5000)
        )
      )
      .orderBy(desc(polymarketMarket.volume24hr))
      .limit(params.limit ?? 20);

    return markets.map(({ market, event }) => ({
      ...market,
      event: {
        id: event.id,
        title: event.title,
        slug: event.slug,
        image: event.image,
        tags: event.tags,
      },
    }));
  },

  async getTrendingEvents(params: { limit?: number } = {}) {
    const events = await db
      .select()
      .from(polymarketEvent)
      .where(
        and(
          eq(polymarketEvent.active, true),
          eq(polymarketEvent.closed, false),
          gte(polymarketEvent.volume24hr, 10_000)
        )
      )
      .orderBy(desc(polymarketEvent.volume24hr))
      .limit(params.limit ?? 10);

    return events;
  },

  // === НОВЫЕ МЕТОДЫ ДЛЯ LLM ИНТЕГРАЦИИ ===

  async createProbabilitySnapshot(marketId: string): Promise<void> {
    const { polymarketProbabilitySnapshot } = await import("@trader/db");

    const market = await db
      .select()
      .from(polymarketMarket)
      .where(eq(polymarketMarket.id, marketId))
      .limit(1);

    if (!market[0]) return;

    const prices = market[0].outcomePrices;
    const probability = prices?.[0] ? Number.parseFloat(prices[0]) : null;

    if (probability === null || Number.isNaN(probability)) return;

    await db.insert(polymarketProbabilitySnapshot).values({
      marketId,
      probability,
      volume24h: market[0].volume24hr,
      liquidity: market[0].liquidity,
    });
  },

  async getProbabilityChanges(
    marketId: string,
    hoursBack = 24
  ): Promise<{
    startProbability: number;
    endProbability: number;
    change: number;
    changePercent: number;
    trend: "up" | "down" | "stable";
  } | null> {
    const { polymarketProbabilitySnapshot } = await import("@trader/db");
    const { asc } = await import("drizzle-orm");

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const snapshots = await db
      .select()
      .from(polymarketProbabilitySnapshot)
      .where(
        and(
          eq(polymarketProbabilitySnapshot.marketId, marketId),
          gte(polymarketProbabilitySnapshot.timestamp, since)
        )
      )
      .orderBy(asc(polymarketProbabilitySnapshot.timestamp));

    if (snapshots.length < 2) return null;

    const first = snapshots[0]!;
    const last = snapshots[snapshots.length - 1]!;

    const change = last.probability - first.probability;
    const changePercent =
      first.probability > 0 ? (change / first.probability) * 100 : 0;

    let trend: "up" | "down" | "stable" = "stable";
    if (change > 0.02) trend = "up";
    else if (change < -0.02) trend = "down";

    return {
      startProbability: first.probability,
      endProbability: last.probability,
      change,
      changePercent,
      trend,
    };
  },

  async findRelevantEvents(
    symbol: string,
    params: { limit?: number; minVolume?: number } = {}
  ) {
    const { polymarketAssetMapping } = await import("@trader/db");
    const { ilike } = await import("drizzle-orm");

    // Сначала ищем по маппингу
    const mapped = await db
      .select({
        event: polymarketEvent,
        mapping: polymarketAssetMapping,
      })
      .from(polymarketAssetMapping)
      .innerJoin(
        polymarketEvent,
        eq(polymarketAssetMapping.eventId, polymarketEvent.id)
      )
      .where(
        and(
          eq(polymarketAssetMapping.symbol, symbol.toUpperCase()),
          eq(polymarketEvent.active, true),
          eq(polymarketEvent.closed, false)
        )
      )
      .orderBy(desc(polymarketAssetMapping.relevance))
      .limit(params.limit ?? 10);

    // Также ищем по ключевым словам в title/description
    const keywords = getSymbolKeywords(symbol);

    const byKeyword = await db
      .select()
      .from(polymarketEvent)
      .where(
        and(
          eq(polymarketEvent.active, true),
          eq(polymarketEvent.closed, false),
          or(
            ...keywords.flatMap((kw) => [
              ilike(polymarketEvent.title, `%${kw}%`),
              ilike(polymarketEvent.description, `%${kw}%`),
            ])
          ),
          params.minVolume
            ? gte(polymarketEvent.volume, params.minVolume)
            : undefined
        )
      )
      .orderBy(desc(polymarketEvent.volume))
      .limit(params.limit ?? 10);

    // Объединяем результаты, убирая дубликаты
    const eventIds = new Set(mapped.map((m) => m.event.id));
    const combined = [
      ...mapped.map((m) => ({
        event: m.event,
        relevance: m.mapping.relevance,
        source: "mapping" as const,
      })),
      ...byKeyword
        .filter((e) => !eventIds.has(e.id))
        .map((e) => ({
          event: e,
          relevance: 0.5,
          source: "keyword" as const,
        })),
    ];

    return combined.slice(0, params.limit ?? 10);
  },

  async fetchAndSavePriceHistory(
    marketId: string,
    interval: "1h" | "6h" | "1d" | "max" = "1d"
  ): Promise<void> {
    const { polymarketPriceHistory } = await import("@trader/db");

    const market = await this.getMarketWithTokenId(marketId);
    if (!market?.clobTokenIds?.length) return;

    const tokenId = market.clobTokenIds[0]!;
    const history = await this.getPriceHistory(tokenId, interval);

    for (const point of history) {
      await db
        .insert(polymarketPriceHistory)
        .values({
          marketId,
          tokenId,
          timestamp: new Date(point.t * 1000),
          price: point.p,
        })
        .onConflictDoNothing();
    }
  },

  async fetchComments(eventId: string): Promise<number> {
    const { polymarketComment } = await import("@trader/db");

    // Gamma API endpoint для комментариев (если доступен)
    const url = `${GAMMA_API_BASE}/comments?event=${eventId}&limit=100`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        // API комментариев может быть недоступен
        return 0;
      }

      const comments = (await response.json()) as Array<{
        id: string;
        marketId?: string;
        userAddress?: string;
        content: string;
        parentId?: string;
        reactions?: { likes: number; dislikes: number };
        createdAt: string;
      }>;

      let savedCount = 0;
      for (const comment of comments) {
        await db
          .insert(polymarketComment)
          .values({
            id: comment.id,
            eventId,
            marketId: comment.marketId ?? null,
            userAddress: comment.userAddress ?? null,
            content: comment.content,
            parentId: comment.parentId ?? null,
            reactions: comment.reactions ?? null,
            createdAt: new Date(comment.createdAt),
          })
          .onConflictDoNothing();
        savedCount++;
      }

      return savedCount;
    } catch {
      return 0;
    }
  },

  async fetchTopHolders(marketId: string): Promise<number> {
    const { polymarketHolder } = await import("@trader/db");

    const market = await this.getMarketWithTokenId(marketId);
    if (!market?.conditionId) return 0;

    // Data API для holders
    const url = `https://data-api.polymarket.com/holders?market=${market.conditionId}&limit=50`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        return 0;
      }

      const data = (await response.json()) as Array<{
        token: string;
        holders: Array<{
          wallet: string;
          pseudonym?: string;
          amount: number;
        }>;
      }>;

      // Очищаем старые данные
      await db
        .delete(polymarketHolder)
        .where(eq(polymarketHolder.marketId, marketId));

      let savedCount = 0;
      for (const token of data) {
        for (const [rank, holder] of token.holders.entries()) {
          await db.insert(polymarketHolder).values({
            marketId,
            tokenId: token.token,
            walletAddress: holder.wallet,
            pseudonym: holder.pseudonym ?? null,
            amount: holder.amount,
            rank: String(rank + 1),
          });
          savedCount++;
        }
      }

      return savedCount;
    } catch {
      return 0;
    }
  },

  async getRecentComments(eventId: string, limit = 5) {
    const { polymarketComment } = await import("@trader/db");

    const comments = await db
      .select()
      .from(polymarketComment)
      .where(eq(polymarketComment.eventId, eventId))
      .orderBy(desc(polymarketComment.createdAt))
      .limit(limit);

    return comments;
  },

  async getTopHolders(marketId: string, limit = 10) {
    const { polymarketHolder } = await import("@trader/db");
    const { asc } = await import("drizzle-orm");

    const holders = await db
      .select()
      .from(polymarketHolder)
      .where(eq(polymarketHolder.marketId, marketId))
      .orderBy(asc(polymarketHolder.rank))
      .limit(limit);

    return holders;
  },

  async createSnapshotsForActiveMarkets(): Promise<number> {
    const activeMarkets = await db
      .select()
      .from(polymarketMarket)
      .where(
        and(
          eq(polymarketMarket.active, true),
          eq(polymarketMarket.closed, false)
        )
      )
      .limit(100);

    let count = 0;
    for (const market of activeMarkets) {
      await this.createProbabilitySnapshot(market.id);
      count++;
    }

    return count;
  },
};

// Хелпер для получения ключевых слов по символу
function getSymbolKeywords(symbol: string): string[] {
  const keywordMap: Record<string, string[]> = {
    BTC: ["bitcoin", "btc"],
    ETH: ["ethereum", "eth"],
    SOL: ["solana", "sol"],
    XRP: ["ripple", "xrp"],
    ADA: ["cardano", "ada"],
    DOGE: ["dogecoin", "doge"],
    AVAX: ["avalanche", "avax"],
    LINK: ["chainlink", "link"],
    DOT: ["polkadot", "dot"],
    MATIC: ["polygon", "matic"],
  };

  const upper = symbol.toUpperCase();
  return keywordMap[upper] ?? [symbol.toLowerCase()];
}
