import {
  db,
  newsArticle,
  newsTag,
  tagMention,
  trendSnapshot,
} from "@trader/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";

// Типы периодов для снимков
type PeriodType = "1h" | "24h" | "7d";

interface TrendData {
  tagId: string;
  tagName: string;
  tagType: string;
  mentionCount: number;
  uniqueArticles: number;
  uniqueSources: number;
  avgSentiment: number | null;
  avgRelevance: number | null;
  velocityChange: number | null;
  accelerationChange: number | null;
}

interface HotTrend extends TrendData {
  previousMentionCount: number;
  growthPercent: number;
}

interface SentimentDistribution {
  very_bullish: number;
  bullish: number;
  neutral: number;
  bearish: number;
  very_bearish: number;
}

// Получение временных границ для периода
function getPeriodBounds(periodType: PeriodType): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;

  switch (periodType) {
    case "1h":
      start = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case "24h":
      start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "7d":
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
  }

  return { start, end };
}

// Получение предыдущего периода для сравнения
function getPreviousPeriodBounds(periodType: PeriodType): {
  start: Date;
  end: Date;
} {
  const current = getPeriodBounds(periodType);
  const duration = current.end.getTime() - current.start.getTime();

  return {
    start: new Date(current.start.getTime() - duration),
    end: current.start,
  };
}

export const trendAggregatorService = {
  // Агрегация данных по тегу за период
  async aggregateTagData(
    tagId: string,
    periodType: PeriodType
  ): Promise<TrendData | null> {
    const { start, end } = getPeriodBounds(periodType);
    const previous = getPreviousPeriodBounds(periodType);

    // Получаем данные тега
    const [tag] = await db.select().from(newsTag).where(eq(newsTag.id, tagId));

    if (!tag) return null;

    // Текущий период
    const [currentMetrics] = await db
      .select({
        mentionCount: sql<number>`COUNT(*)`,
        uniqueArticles: sql<number>`COUNT(DISTINCT ${tagMention.articleId})`,
        avgSentiment: sql<number>`AVG(${tagMention.sentimentScore}::numeric)`,
        avgRelevance: sql<number>`AVG(${tagMention.relevance}::numeric)`,
      })
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, start),
          lte(tagMention.createdAt, end)
        )
      );

    // Предыдущий период для velocity
    const [previousMetrics] = await db
      .select({
        mentionCount: sql<number>`COUNT(*)`,
      })
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, previous.start),
          lte(tagMention.createdAt, previous.end)
        )
      );

    // Уникальные источники
    const [sourceCount] = await db
      .select({
        count: sql<number>`COUNT(DISTINCT ${newsArticle.sourceId})`,
      })
      .from(tagMention)
      .innerJoin(newsArticle, eq(tagMention.articleId, newsArticle.id))
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, start),
          lte(tagMention.createdAt, end)
        )
      );

    // Вычисляем velocity (процентное изменение)
    const currentCount = currentMetrics?.mentionCount || 0;
    const previousCount = previousMetrics?.mentionCount || 0;

    let velocityChange: number | null = null;
    if (previousCount > 0) {
      velocityChange = ((currentCount - previousCount) / previousCount) * 100;
    } else if (currentCount > 0) {
      velocityChange = 100; // Новый тренд
    }

    // Для acceleration нужен ещё один период назад
    const twoPeriodsBefore = {
      start: new Date(
        previous.start.getTime() -
          (previous.end.getTime() - previous.start.getTime())
      ),
      end: previous.start,
    };

    const [twoPeriodsMetrics] = await db
      .select({
        mentionCount: sql<number>`COUNT(*)`,
      })
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, twoPeriodsBefore.start),
          lte(tagMention.createdAt, twoPeriodsBefore.end)
        )
      );

    let accelerationChange: number | null = null;
    const twoPeriodsCount = twoPeriodsMetrics?.mentionCount || 0;

    if (twoPeriodsCount > 0 && previousCount > 0) {
      const previousVelocity =
        ((previousCount - twoPeriodsCount) / twoPeriodsCount) * 100;
      if (velocityChange !== null) {
        accelerationChange = velocityChange - previousVelocity;
      }
    }

    return {
      tagId,
      tagName: tag.name,
      tagType: tag.type,
      mentionCount: currentCount,
      uniqueArticles: currentMetrics?.uniqueArticles || 0,
      uniqueSources: sourceCount?.count || 0,
      avgSentiment: currentMetrics?.avgSentiment ?? null,
      avgRelevance: currentMetrics?.avgRelevance ?? null,
      velocityChange,
      accelerationChange,
    };
  },

  // Получение распределения sentiment для тега
  async getSentimentDistribution(
    tagId: string,
    periodType: PeriodType
  ): Promise<SentimentDistribution> {
    const { start, end } = getPeriodBounds(periodType);

    const results = await db
      .select({
        sentiment: tagMention.sentiment,
        count: sql<number>`COUNT(*)`,
      })
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, start),
          lte(tagMention.createdAt, end)
        )
      )
      .groupBy(tagMention.sentiment);

    const distribution: SentimentDistribution = {
      very_bullish: 0,
      bullish: 0,
      neutral: 0,
      bearish: 0,
      very_bearish: 0,
    };

    for (const row of results) {
      if (row.sentiment && row.sentiment in distribution) {
        distribution[row.sentiment as keyof SentimentDistribution] = row.count;
      }
    }

    return distribution;
  },

  // Получение связанных тегов (co-occurrence)
  async getRelatedTags(
    tagId: string,
    periodType: PeriodType,
    limit = 10
  ): Promise<Array<{ tagId: string; name: string; coOccurrences: number }>> {
    const { start, end } = getPeriodBounds(periodType);

    // Находим статьи с этим тегом
    const articlesWithTag = db
      .select({ articleId: tagMention.articleId })
      .from(tagMention)
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, start),
          lte(tagMention.createdAt, end)
        )
      );

    // Находим другие теги в этих статьях
    const relatedTags = await db
      .select({
        tagId: tagMention.tagId,
        name: newsTag.name,
        coOccurrences: sql<number>`COUNT(*)`,
      })
      .from(tagMention)
      .innerJoin(newsTag, eq(tagMention.tagId, newsTag.id))
      .where(
        and(
          sql`${tagMention.articleId} IN (${articlesWithTag})`,
          sql`${tagMention.tagId} != ${tagId}`
        )
      )
      .groupBy(tagMention.tagId, newsTag.name)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(limit);

    return relatedTags;
  },

  // Получение топ статей для тега
  async getTopArticles(
    tagId: string,
    periodType: PeriodType,
    limit = 5
  ): Promise<Array<{ articleId: string; title: string; relevance: number }>> {
    const { start, end } = getPeriodBounds(periodType);

    const articles = await db
      .select({
        articleId: tagMention.articleId,
        title: newsArticle.title,
        relevance: tagMention.relevance,
      })
      .from(tagMention)
      .innerJoin(newsArticle, eq(tagMention.articleId, newsArticle.id))
      .where(
        and(
          eq(tagMention.tagId, tagId),
          gte(tagMention.createdAt, start),
          lte(tagMention.createdAt, end)
        )
      )
      .orderBy(desc(tagMention.relevance))
      .limit(limit);

    return articles.map((a) => ({
      articleId: a.articleId,
      title: a.title,
      relevance: Number(a.relevance),
    }));
  },

  // Создание снимка тренда
  async createSnapshot(
    tagId: string,
    periodType: PeriodType
  ): Promise<string | null> {
    const trendData = await this.aggregateTagData(tagId, periodType);

    if (!trendData || trendData.mentionCount === 0) {
      return null;
    }

    const { start, end } = getPeriodBounds(periodType);

    const [sentimentDistribution, relatedTags, topArticles] = await Promise.all(
      [
        this.getSentimentDistribution(tagId, periodType),
        this.getRelatedTags(tagId, periodType),
        this.getTopArticles(tagId, periodType),
      ]
    );

    // Проверяем существующий снимок
    const [existing] = await db
      .select()
      .from(trendSnapshot)
      .where(
        and(
          eq(trendSnapshot.tagId, tagId),
          eq(trendSnapshot.periodStart, start),
          eq(trendSnapshot.periodType, periodType)
        )
      );

    if (existing) {
      // Обновляем существующий
      await db
        .update(trendSnapshot)
        .set({
          mentionCount: trendData.mentionCount.toString(),
          uniqueArticles: trendData.uniqueArticles.toString(),
          uniqueSources: trendData.uniqueSources.toString(),
          avgSentiment: trendData.avgSentiment?.toString(),
          avgRelevance: trendData.avgRelevance?.toString(),
          velocityChange: trendData.velocityChange?.toString(),
          accelerationChange: trendData.accelerationChange?.toString(),
          relatedTags,
          topArticles,
          sentimentDistribution,
        })
        .where(eq(trendSnapshot.id, existing.id));

      return existing.id;
    }

    // Создаём новый снимок
    const [created] = await db
      .insert(trendSnapshot)
      .values({
        tagId,
        periodStart: start,
        periodEnd: end,
        periodType,
        mentionCount: trendData.mentionCount.toString(),
        uniqueArticles: trendData.uniqueArticles.toString(),
        uniqueSources: trendData.uniqueSources.toString(),
        avgSentiment: trendData.avgSentiment?.toString(),
        avgRelevance: trendData.avgRelevance?.toString(),
        velocityChange: trendData.velocityChange?.toString(),
        accelerationChange: trendData.accelerationChange?.toString(),
        relatedTags,
        topArticles,
        sentimentDistribution,
      })
      .returning();

    return created!.id;
  },

  // Получение "горячих" трендов
  async getHotTrends(periodType: PeriodType, limit = 20): Promise<HotTrend[]> {
    const { start, end } = getPeriodBounds(periodType);
    const previous = getPreviousPeriodBounds(periodType);

    // Получаем теги с активностью за период
    const currentActivity = await db
      .select({
        tagId: tagMention.tagId,
        mentionCount: sql<number>`COUNT(*)`,
        uniqueArticles: sql<number>`COUNT(DISTINCT ${tagMention.articleId})`,
        avgSentiment: sql<number>`AVG(${tagMention.sentimentScore}::numeric)`,
        avgRelevance: sql<number>`AVG(${tagMention.relevance}::numeric)`,
      })
      .from(tagMention)
      .where(
        and(gte(tagMention.createdAt, start), lte(tagMention.createdAt, end))
      )
      .groupBy(tagMention.tagId)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(100); // Берём больше для фильтрации

    // Для каждого тега получаем предыдущую активность
    const hotTrends: HotTrend[] = [];

    for (const current of currentActivity) {
      const [tag] = await db
        .select()
        .from(newsTag)
        .where(eq(newsTag.id, current.tagId));

      if (!tag) continue;

      const [previousActivity] = await db
        .select({
          mentionCount: sql<number>`COUNT(*)`,
        })
        .from(tagMention)
        .where(
          and(
            eq(tagMention.tagId, current.tagId),
            gte(tagMention.createdAt, previous.start),
            lte(tagMention.createdAt, previous.end)
          )
        );

      const previousCount = previousActivity?.mentionCount || 0;
      let growthPercent = 0;

      if (previousCount > 0) {
        growthPercent =
          ((current.mentionCount - previousCount) / previousCount) * 100;
      } else if (current.mentionCount > 0) {
        growthPercent = 100; // Новый тренд
      }

      // Получаем количество уникальных источников
      const [sourceCount] = await db
        .select({
          count: sql<number>`COUNT(DISTINCT ${newsArticle.sourceId})`,
        })
        .from(tagMention)
        .innerJoin(newsArticle, eq(tagMention.articleId, newsArticle.id))
        .where(
          and(
            eq(tagMention.tagId, current.tagId),
            gte(tagMention.createdAt, start),
            lte(tagMention.createdAt, end)
          )
        );

      hotTrends.push({
        tagId: current.tagId,
        tagName: tag.name,
        tagType: tag.type,
        mentionCount: current.mentionCount,
        uniqueArticles: current.uniqueArticles,
        uniqueSources: sourceCount?.count || 0,
        avgSentiment: current.avgSentiment,
        avgRelevance: current.avgRelevance,
        velocityChange: growthPercent,
        accelerationChange: null,
        previousMentionCount: previousCount,
        growthPercent,
      });
    }

    // Сортируем по росту и возвращаем топ
    return hotTrends
      .sort((a, b) => b.growthPercent - a.growthPercent)
      .slice(0, limit);
  },

  // Создание снимков для всех активных тегов
  async createSnapshotsForAllTags(periodType: PeriodType): Promise<number> {
    const { start, end } = getPeriodBounds(periodType);

    // Находим теги с активностью за период
    const activeTags = await db
      .selectDistinct({ tagId: tagMention.tagId })
      .from(tagMention)
      .where(
        and(gte(tagMention.createdAt, start), lte(tagMention.createdAt, end))
      );

    let created = 0;

    for (const { tagId } of activeTags) {
      const snapshotId = await this.createSnapshot(tagId, periodType);
      if (snapshotId) created++;
    }

    return created;
  },

  // История тренда (timeline)
  async getTagTimeline(
    tagId: string,
    periodType: PeriodType,
    periods = 24
  ): Promise<
    Array<{
      periodStart: Date;
      periodEnd: Date;
      mentionCount: number;
      avgSentiment: number | null;
      velocityChange: number | null;
    }>
  > {
    return db
      .select({
        periodStart: trendSnapshot.periodStart,
        periodEnd: trendSnapshot.periodEnd,
        mentionCount: trendSnapshot.mentionCount,
        avgSentiment: trendSnapshot.avgSentiment,
        velocityChange: trendSnapshot.velocityChange,
      })
      .from(trendSnapshot)
      .where(
        and(
          eq(trendSnapshot.tagId, tagId),
          eq(trendSnapshot.periodType, periodType)
        )
      )
      .orderBy(desc(trendSnapshot.periodStart))
      .limit(periods)
      .then((rows) =>
        rows.map((r) => ({
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          mentionCount: Number(r.mentionCount),
          avgSentiment: r.avgSentiment ? Number(r.avgSentiment) : null,
          velocityChange: r.velocityChange ? Number(r.velocityChange) : null,
        }))
      );
  },
};
