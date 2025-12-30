import { db, newsTag, tagMention, trendAlert } from "@trader/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { EventEmitter } from "events";

// Типы алертов
type AlertType =
  | "spike"
  | "sentiment_shift"
  | "new_entity"
  | "anomaly"
  | "volume_drop";
type AlertSeverity = "low" | "medium" | "high" | "critical";

interface AnomalyConfig {
  // Порог для спайка (множитель относительно среднего)
  spikeThreshold: number;
  // Порог изменения sentiment (-1 to 1 шкала)
  sentimentShiftThreshold: number;
  // Минимальное количество упоминаний для анализа
  minMentionsForAnalysis: number;
  // Период для расчёта базовых метрик (часы)
  baselinePeriodHours: number;
  // Период для сравнения (часы)
  comparisonPeriodHours: number;
}

const DEFAULT_CONFIG: AnomalyConfig = {
  spikeThreshold: 3.0, // 3x относительно среднего
  sentimentShiftThreshold: 0.4, // 40% изменение sentiment
  minMentionsForAnalysis: 3,
  baselinePeriodHours: 168, // 7 дней
  comparisonPeriodHours: 1, // 1 час
};

interface DetectedAnomaly {
  tagId: string;
  tagName: string;
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  description: string;
  metrics: {
    previousValue?: number;
    currentValue?: number;
    changePercent?: number;
    threshold?: number;
  };
  relatedArticles: string[];
}

// Event emitter для realtime уведомлений
export const anomalyEvents = new EventEmitter();

export const anomalyDetectorService = {
  config: { ...DEFAULT_CONFIG },

  // Обновление конфигурации
  updateConfig(newConfig: Partial<AnomalyConfig>): void {
    this.config = { ...this.config, ...newConfig };
  },

  // Получение базовых метрик для тега
  async getBaselineMetrics(tagId: string): Promise<{
    avgMentionsPerHour: number;
    avgSentiment: number;
    stdDevMentions: number;
  } | null> {
    const baselineStart = new Date();
    baselineStart.setHours(
      baselineStart.getHours() - this.config.baselinePeriodHours
    );

    const result = await db.execute(sql`
      WITH hourly_mentions AS (
        SELECT 
          date_trunc('hour', created_at) as hour,
          COUNT(*) as mention_count,
          AVG(sentiment_score::numeric) as avg_sentiment
        FROM tag_mention
        WHERE tag_id = ${tagId}
          AND created_at >= ${baselineStart}
        GROUP BY date_trunc('hour', created_at)
      )
      SELECT 
        AVG(mention_count) as avg_mentions,
        STDDEV(mention_count) as std_dev,
        AVG(avg_sentiment) as avg_sentiment
      FROM hourly_mentions
    `);

    const row = result.rows[0] as
      | { avg_mentions: string; std_dev: string; avg_sentiment: string }
      | undefined;
    if (!(row && row.avg_mentions)) return null;

    return {
      avgMentionsPerHour: Number(row.avg_mentions) || 0,
      avgSentiment: Number(row.avg_sentiment) || 0,
      stdDevMentions: Number(row.std_dev) || 0,
    };
  },

  // Получение текущих метрик за последний период
  async getCurrentMetrics(tagId: string): Promise<{
    mentionCount: number;
    avgSentiment: number;
    articleIds: string[];
  }> {
    const periodStart = new Date();
    periodStart.setHours(
      periodStart.getHours() - this.config.comparisonPeriodHours
    );

    const mentions = await db
      .select({
        articleId: tagMention.articleId,
        sentimentScore: tagMention.sentimentScore,
      })
      .from(tagMention)
      .where(
        and(eq(tagMention.tagId, tagId), gte(tagMention.createdAt, periodStart))
      );

    const avgSentiment =
      mentions.length > 0
        ? mentions.reduce(
            (sum, m) => sum + (Number(m.sentimentScore) || 0),
            0
          ) / mentions.length
        : 0;

    return {
      mentionCount: mentions.length,
      avgSentiment,
      articleIds: mentions.map((m) => m.articleId),
    };
  },

  // Определение severity на основе отклонения
  determineSeverity(deviation: number): AlertSeverity {
    if (deviation >= 5) return "critical";
    if (deviation >= 3) return "high";
    if (deviation >= 2) return "medium";
    return "low";
  },

  // Проверка на спайк упоминаний
  async checkForSpike(tagId: string): Promise<DetectedAnomaly | null> {
    const baseline = await this.getBaselineMetrics(tagId);
    if (!baseline) return null;

    const current = await this.getCurrentMetrics(tagId);

    if (current.mentionCount < this.config.minMentionsForAnalysis) {
      return null;
    }

    const expectedMentions =
      baseline.avgMentionsPerHour * this.config.comparisonPeriodHours;

    if (expectedMentions === 0 && current.mentionCount > 0) {
      // Новая активность для ранее неактивного тега
      const [tag] = await db
        .select({ name: newsTag.name })
        .from(newsTag)
        .where(eq(newsTag.id, tagId));

      return {
        tagId,
        tagName: tag?.name || "Unknown",
        alertType: "spike",
        severity: "medium",
        title: `Sudden activity for ${tag?.name || "Unknown"}`,
        description: `Tag went from inactive to ${current.mentionCount} mentions in the last ${this.config.comparisonPeriodHours}h`,
        metrics: {
          previousValue: 0,
          currentValue: current.mentionCount,
          changePercent: 100,
        },
        relatedArticles: current.articleIds,
      };
    }

    const deviation =
      baseline.stdDevMentions > 0
        ? (current.mentionCount - expectedMentions) / baseline.stdDevMentions
        : current.mentionCount / Math.max(expectedMentions, 1);

    if (deviation >= this.config.spikeThreshold) {
      const [tag] = await db
        .select({ name: newsTag.name })
        .from(newsTag)
        .where(eq(newsTag.id, tagId));

      const changePercent =
        expectedMentions > 0
          ? ((current.mentionCount - expectedMentions) / expectedMentions) * 100
          : 100;

      return {
        tagId,
        tagName: tag?.name || "Unknown",
        alertType: "spike",
        severity: this.determineSeverity(deviation),
        title: `Mention spike detected: ${tag?.name || "Unknown"}`,
        description: `${current.mentionCount} mentions in the last ${this.config.comparisonPeriodHours}h (${changePercent.toFixed(0)}% above average)`,
        metrics: {
          previousValue: expectedMentions,
          currentValue: current.mentionCount,
          changePercent,
          threshold: this.config.spikeThreshold,
        },
        relatedArticles: current.articleIds,
      };
    }

    return null;
  },

  // Проверка на резкое изменение sentiment
  async checkForSentimentShift(tagId: string): Promise<DetectedAnomaly | null> {
    const baseline = await this.getBaselineMetrics(tagId);
    if (!baseline) return null;

    const current = await this.getCurrentMetrics(tagId);

    if (current.mentionCount < this.config.minMentionsForAnalysis) {
      return null;
    }

    const sentimentDelta = Math.abs(
      current.avgSentiment - baseline.avgSentiment
    );

    if (sentimentDelta >= this.config.sentimentShiftThreshold) {
      const [tag] = await db
        .select({ name: newsTag.name })
        .from(newsTag)
        .where(eq(newsTag.id, tagId));

      const direction =
        current.avgSentiment > baseline.avgSentiment ? "positive" : "negative";

      const severity: AlertSeverity =
        sentimentDelta >= 0.7
          ? "critical"
          : sentimentDelta >= 0.5
            ? "high"
            : "medium";

      return {
        tagId,
        tagName: tag?.name || "Unknown",
        alertType: "sentiment_shift",
        severity,
        title: `Sentiment ${direction} shift: ${tag?.name || "Unknown"}`,
        description: `Sentiment changed from ${baseline.avgSentiment.toFixed(2)} to ${current.avgSentiment.toFixed(2)}`,
        metrics: {
          previousValue: baseline.avgSentiment,
          currentValue: current.avgSentiment,
          changePercent: sentimentDelta * 100,
          threshold: this.config.sentimentShiftThreshold,
        },
        relatedArticles: current.articleIds,
      };
    }

    return null;
  },

  // Проверка на появление нового важного тега
  async checkForNewEntities(hoursBack = 24): Promise<DetectedAnomaly[]> {
    const periodStart = new Date();
    periodStart.setHours(periodStart.getHours() - hoursBack);

    // Теги созданные недавно с высокой активностью
    const newTags = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        totalMentions: newsTag.totalMentions,
        createdAt: newsTag.createdAt,
      })
      .from(newsTag)
      .where(
        and(
          gte(newsTag.createdAt, periodStart),
          gte(sql`${newsTag.totalMentions}::numeric`, 3)
        )
      )
      .orderBy(desc(sql`${newsTag.totalMentions}::numeric`))
      .limit(10);

    const anomalies: DetectedAnomaly[] = [];

    for (const tag of newTags) {
      const mentions = await db
        .select({ articleId: tagMention.articleId })
        .from(tagMention)
        .where(eq(tagMention.tagId, tag.id))
        .limit(10);

      const severity: AlertSeverity =
        Number(tag.totalMentions) >= 10
          ? "high"
          : Number(tag.totalMentions) >= 5
            ? "medium"
            : "low";

      anomalies.push({
        tagId: tag.id,
        tagName: tag.name,
        alertType: "new_entity",
        severity,
        title: `New ${tag.type} emerged: ${tag.name}`,
        description: `New ${tag.type} "${tag.name}" appeared with ${tag.totalMentions} mentions in ${hoursBack}h`,
        metrics: {
          currentValue: Number(tag.totalMentions),
        },
        relatedArticles: mentions.map((m) => m.articleId),
      });
    }

    return anomalies;
  },

  // Запуск полного сканирования на аномалии
  async runFullScan(): Promise<{
    scanned: number;
    anomaliesDetected: number;
    alertsCreated: number;
  }> {
    // Получаем активные теги за последние 7 дней
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const activeTags = await db
      .select({ id: newsTag.id })
      .from(newsTag)
      .where(gte(newsTag.lastSeenAt, sevenDaysAgo));

    let scanned = 0;
    let anomaliesDetected = 0;
    let alertsCreated = 0;

    for (const tag of activeTags) {
      scanned++;

      // Проверяем спайки
      const spikeAnomaly = await this.checkForSpike(tag.id);
      if (spikeAnomaly) {
        anomaliesDetected++;
        const created = await this.createAlert(spikeAnomaly);
        if (created) alertsCreated++;
      }

      // Проверяем sentiment shifts
      const sentimentAnomaly = await this.checkForSentimentShift(tag.id);
      if (sentimentAnomaly) {
        anomaliesDetected++;
        const created = await this.createAlert(sentimentAnomaly);
        if (created) alertsCreated++;
      }
    }

    // Проверяем новые сущности
    const newEntities = await this.checkForNewEntities();
    for (const anomaly of newEntities) {
      anomaliesDetected++;
      const created = await this.createAlert(anomaly);
      if (created) alertsCreated++;
    }

    return { scanned, anomaliesDetected, alertsCreated };
  },

  // Создание алерта
  async createAlert(anomaly: DetectedAnomaly): Promise<boolean> {
    // Проверяем нет ли уже похожего алерта за последний час
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const [existing] = await db
      .select({ id: trendAlert.id })
      .from(trendAlert)
      .where(
        and(
          eq(trendAlert.tagId, anomaly.tagId),
          eq(trendAlert.alertType, anomaly.alertType),
          gte(trendAlert.createdAt, oneHourAgo)
        )
      )
      .limit(1);

    if (existing) {
      return false; // Алерт уже существует
    }

    // Создаём алерт
    const [alert] = await db
      .insert(trendAlert)
      .values({
        tagId: anomaly.tagId,
        alertType: anomaly.alertType,
        severity: anomaly.severity,
        title: anomaly.title,
        description: anomaly.description,
        metrics: anomaly.metrics,
        relatedArticles: anomaly.relatedArticles,
      })
      .returning();

    // Эмитим событие для realtime уведомлений
    if (alert) {
      anomalyEvents.emit("alert", {
        ...anomaly,
        alertId: alert.id,
        createdAt: alert.createdAt,
      });
    }

    return true;
  },

  // Получение активных алертов
  async getActiveAlerts(options?: {
    severity?: AlertSeverity;
    type?: AlertType;
    limit?: number;
    onlyUnacknowledged?: boolean;
  }): Promise<
    {
      id: string;
      tagId: string;
      tagName: string;
      alertType: string;
      severity: string;
      title: string;
      description: string | null;
      metrics: Record<string, number> | null;
      acknowledged: boolean;
      createdAt: Date;
    }[]
  > {
    const {
      severity,
      type,
      limit = 50,
      onlyUnacknowledged = false,
    } = options || {};

    const conditions = [];

    if (severity) {
      conditions.push(eq(trendAlert.severity, severity));
    }
    if (type) {
      conditions.push(eq(trendAlert.alertType, type));
    }
    if (onlyUnacknowledged) {
      conditions.push(eq(trendAlert.acknowledged, false));
    }

    const alerts = await db
      .select({
        id: trendAlert.id,
        tagId: trendAlert.tagId,
        tagName: newsTag.name,
        alertType: trendAlert.alertType,
        severity: trendAlert.severity,
        title: trendAlert.title,
        description: trendAlert.description,
        metrics: trendAlert.metrics,
        acknowledged: trendAlert.acknowledged,
        createdAt: trendAlert.createdAt,
      })
      .from(trendAlert)
      .innerJoin(newsTag, eq(trendAlert.tagId, newsTag.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(trendAlert.createdAt))
      .limit(limit);

    return alerts.map((a) => ({
      ...a,
      metrics: a.metrics as Record<string, number> | null,
    }));
  },

  // Подтверждение алерта
  async acknowledgeAlert(alertId: string, userId: string): Promise<boolean> {
    const result = await db
      .update(trendAlert)
      .set({
        acknowledged: true,
        acknowledgedAt: new Date(),
        acknowledgedBy: userId,
      })
      .where(eq(trendAlert.id, alertId));

    return (result.rowCount || 0) > 0;
  },

  // Статистика алертов
  async getAlertStats(): Promise<{
    total: number;
    unacknowledged: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    last24h: number;
  }> {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const [total] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trendAlert);

    const [unacknowledged] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trendAlert)
      .where(eq(trendAlert.acknowledged, false));

    const [last24h] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trendAlert)
      .where(gte(trendAlert.createdAt, twentyFourHoursAgo));

    const bySeverityResult = await db
      .select({
        severity: trendAlert.severity,
        count: sql<number>`count(*)`,
      })
      .from(trendAlert)
      .groupBy(trendAlert.severity);

    const byTypeResult = await db
      .select({
        type: trendAlert.alertType,
        count: sql<number>`count(*)`,
      })
      .from(trendAlert)
      .groupBy(trendAlert.alertType);

    const bySeverity: Record<string, number> = {};
    for (const row of bySeverityResult) {
      bySeverity[row.severity] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of byTypeResult) {
      byType[row.type] = row.count;
    }

    return {
      total: total?.count || 0,
      unacknowledged: unacknowledged?.count || 0,
      bySeverity,
      byType,
      last24h: last24h?.count || 0,
    };
  },
};
