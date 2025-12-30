import { db, newsArticle, newsTag, tagMention } from "@trader/db";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { openaiService } from "../llm";
import type {
  ExtractedEntity,
  ExtractedEvent,
  ExtractedRegion,
  ExtractedTopic,
  Sentiment,
  TagExtractionResult,
} from "../llm/types";

// Маппинг для нормализации названий
const ALIAS_MAP: Record<string, string> = {
  btc: "Bitcoin",
  bitcoin: "Bitcoin",
  биткоин: "Bitcoin",
  eth: "Ethereum",
  ethereum: "Ethereum",
  эфир: "Ethereum",
  эфириум: "Ethereum",
  xrp: "XRP",
  ripple: "XRP",
  рипл: "XRP",
  sol: "Solana",
  solana: "Solana",
  солана: "Solana",
  bnb: "BNB",
  binance: "Binance",
  бинанс: "Binance",
  coinbase: "Coinbase",
  коинбейс: "Coinbase",
  sec: "SEC",
  "securities and exchange commission": "SEC",
  cftc: "CFTC",
  fed: "Federal Reserve",
  "federal reserve": "Federal Reserve",
  фрс: "Federal Reserve",
  usa: "USA",
  "united states": "USA",
  us: "USA",
  сша: "USA",
  china: "China",
  китай: "China",
  eu: "European Union",
  "european union": "European Union",
  евросоюз: "European Union",
};

// Нормализация строки для поиска
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zа-яё0-9]/gi, "")
    .trim();
}

// Получение канонического имени
function getCanonicalName(name: string): string {
  const normalized = normalizeString(name);
  return ALIAS_MAP[normalized] || name;
}

// Определение типа тега
type TagType = "entity" | "topic" | "event" | "region";

interface CreateTagInput {
  name: string;
  type: TagType;
  subtype?: string;
  aliases?: string[];
}

interface CreateMentionInput {
  tagId: string;
  articleId: string;
  analysisId?: string;
  sentiment?: Sentiment;
  sentimentScore?: number;
  relevance: number;
  context?: string;
  eventDate?: Date;
  severity?: number;
}

export const tagExtractorService = {
  // Найти или создать тег
  async findOrCreateTag(input: CreateTagInput): Promise<string> {
    const canonicalName = getCanonicalName(input.name);
    const normalizedName = normalizeString(canonicalName);

    // Ищем существующий тег
    const [existing] = await db
      .select()
      .from(newsTag)
      .where(
        and(
          eq(newsTag.normalizedName, normalizedName),
          eq(newsTag.type, input.type)
        )
      );

    if (existing) {
      // Обновляем aliases если есть новые
      if (input.aliases?.length) {
        const currentAliases = (existing.aliases as string[]) || [];
        const newAliases = input.aliases.filter(
          (a) =>
            !currentAliases.some(
              (ca) => normalizeString(ca) === normalizeString(a)
            )
        );

        if (newAliases.length > 0) {
          await db
            .update(newsTag)
            .set({ aliases: [...currentAliases, ...newAliases] })
            .where(eq(newsTag.id, existing.id));
        }
      }
      return existing.id;
    }

    // Создаём новый тег
    const [created] = await db
      .insert(newsTag)
      .values({
        name: canonicalName,
        normalizedName,
        type: input.type,
        subtype: input.subtype,
        aliases: input.aliases || [],
      })
      .returning();

    return created!.id;
  },

  // Создать упоминание тега
  async createMention(input: CreateMentionInput): Promise<string> {
    // Проверяем на дубликат
    const [existing] = await db
      .select()
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, input.tagId),
          eq(tagMention.articleId, input.articleId)
        )
      );

    if (existing) {
      return existing.id;
    }

    const [created] = await db
      .insert(tagMention)
      .values({
        tagId: input.tagId,
        articleId: input.articleId,
        analysisId: input.analysisId,
        sentiment: input.sentiment,
        sentimentScore: input.sentimentScore?.toString(),
        relevance: input.relevance.toString(),
        context: input.context,
        eventDate: input.eventDate,
        severity: input.severity?.toString(),
      })
      .returning();

    return created!.id;
  },

  // Обработка извлечённых сущностей
  async processEntities(
    entities: ExtractedEntity[],
    articleId: string,
    analysisId?: string
  ): Promise<void> {
    for (const entity of entities) {
      const tagId = await this.findOrCreateTag({
        name: entity.name,
        type: "entity",
        subtype: entity.type,
        aliases: entity.aliases,
      });

      await this.createMention({
        tagId,
        articleId,
        analysisId,
        sentiment: entity.sentiment,
        sentimentScore: this.sentimentToScore(entity.sentiment),
        relevance: entity.relevance,
        context: entity.context,
      });
    }
  },

  // Обработка извлечённых топиков
  async processTopics(
    topics: ExtractedTopic[],
    articleId: string,
    analysisId?: string
  ): Promise<void> {
    for (const topic of topics) {
      const tagId = await this.findOrCreateTag({
        name: topic.name,
        type: "topic",
        subtype: topic.category,
      });

      await this.createMention({
        tagId,
        articleId,
        analysisId,
        sentiment: topic.sentiment,
        sentimentScore: this.sentimentToScore(topic.sentiment),
        relevance: topic.relevance,
      });
    }
  },

  // Обработка извлечённых событий
  async processEvents(
    events: ExtractedEvent[],
    articleId: string,
    analysisId?: string
  ): Promise<void> {
    for (const event of events) {
      const tagId = await this.findOrCreateTag({
        name: event.name,
        type: "event",
        subtype: event.type,
      });

      await this.createMention({
        tagId,
        articleId,
        analysisId,
        relevance: event.severity,
        severity: event.severity,
        eventDate: event.date ? new Date(event.date) : undefined,
      });

      // Создаём связи с затронутыми сущностями
      for (const entityName of event.affectedEntities) {
        // Ищем существующий тег сущности
        const normalizedEntityName = normalizeString(
          getCanonicalName(entityName)
        );
        const [entityTag] = await db
          .select()
          .from(newsTag)
          .where(
            and(
              eq(newsTag.normalizedName, normalizedEntityName),
              eq(newsTag.type, "entity")
            )
          );

        if (entityTag) {
          // Связь будет создана в graph-builder
        }
      }
    }
  },

  // Обработка извлечённых регионов
  async processRegions(
    regions: ExtractedRegion[],
    articleId: string,
    analysisId?: string
  ): Promise<void> {
    for (const region of regions) {
      const tagId = await this.findOrCreateTag({
        name: region.name,
        type: "region",
      });

      await this.createMention({
        tagId,
        articleId,
        analysisId,
        sentiment: region.sentiment,
        sentimentScore: this.sentimentToScore(region.sentiment),
        relevance: region.relevance,
      });
    }
  },

  // Конвертация sentiment в числовой score
  sentimentToScore(sentiment: Sentiment): number {
    const scores: Record<Sentiment, number> = {
      very_bullish: 1.0,
      bullish: 0.5,
      neutral: 0.0,
      bearish: -0.5,
      very_bearish: -1.0,
    };
    return scores[sentiment] ?? 0;
  },

  // Главный метод: извлечь теги из статьи
  async extractAndSaveTags(
    articleId: string,
    analysisId?: string
  ): Promise<TagExtractionResult> {
    // Получаем статью
    const [article] = await db
      .select()
      .from(newsArticle)
      .where(eq(newsArticle.id, articleId));

    if (!article) {
      throw new Error(`Article not found: ${articleId}`);
    }

    // Получаем источник для имени
    const source = await db.query.newsSource.findFirst({
      where: (s, { eq }) => eq(s.id, article.sourceId),
    });

    // Вызываем LLM для извлечения тегов
    const response = await openaiService.extractTags({
      title: article.title,
      content: article.content || undefined,
      summary: article.summary || undefined,
      source: source?.name || "Unknown",
      publishedAt: article.publishedAt,
      symbols: (article.symbols as string[]) || undefined,
    });

    const { result } = response;

    // Сохраняем все извлечённые данные
    await Promise.all([
      this.processEntities(result.entities, articleId, analysisId),
      this.processTopics(result.topics, articleId, analysisId),
      this.processEvents(result.events, articleId, analysisId),
      this.processRegions(result.regions, articleId, analysisId),
    ]);

    return result;
  },

  // Batch обработка нескольких статей
  async extractTagsForUnprocessedArticles(
    limit = 10
  ): Promise<{ processed: number; errors: number }> {
    // Находим статьи без упоминаний тегов
    const articlesWithoutTags = await db
      .select({ id: newsArticle.id })
      .from(newsArticle)
      .leftJoin(tagMention, eq(newsArticle.id, tagMention.articleId))
      .where(sql`${tagMention.id} IS NULL`)
      .limit(limit);

    let processed = 0;
    let errors = 0;

    for (const article of articlesWithoutTags) {
      try {
        await this.extractAndSaveTags(article.id);
        processed++;
        // Rate limiting
        await new Promise((r) => setTimeout(r, 500));
      } catch (error) {
        console.error(
          `[TagExtractor] Failed to extract tags for article ${article.id}:`,
          error
        );
        errors++;
      }
    }

    return { processed, errors };
  },

  // Поиск тегов по имени
  async searchTags(
    query: string,
    type?: TagType,
    limit = 20
  ): Promise<
    Array<{ id: string; name: string; type: string; totalMentions: string }>
  > {
    const normalizedQuery = `%${normalizeString(query)}%`;

    const conditions = [
      or(
        ilike(newsTag.normalizedName, normalizedQuery),
        sql`${newsTag.aliases}::text ILIKE ${`%${query}%`}`
      ),
    ];

    if (type) {
      conditions.push(eq(newsTag.type, type));
    }

    return db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        totalMentions: newsTag.totalMentions,
      })
      .from(newsTag)
      .where(and(...conditions))
      .orderBy(sql`${newsTag.totalMentions}::int DESC`)
      .limit(limit);
  },

  // Обновление агрегированных метрик тегов
  async updateTagMetrics(tagId: string): Promise<void> {
    const [metrics] = await db
      .select({
        count: sql<string>`COUNT(*)`,
        avgSentiment: sql<string>`AVG(${tagMention.sentimentScore}::numeric)`,
        lastSeen: sql<Date>`MAX(${tagMention.createdAt})`,
      })
      .from(tagMention)
      .where(eq(tagMention.tagId, tagId));

    if (metrics) {
      await db
        .update(newsTag)
        .set({
          totalMentions: metrics.count,
          avgSentiment: metrics.avgSentiment,
          lastSeenAt: metrics.lastSeen,
        })
        .where(eq(newsTag.id, tagId));
    }
  },

  // Batch обновление метрик всех тегов
  async updateAllTagMetrics(): Promise<number> {
    const tags = await db.select({ id: newsTag.id }).from(newsTag);

    for (const tag of tags) {
      await this.updateTagMetrics(tag.id);
    }

    return tags.length;
  },
};
