import { db, newsTag, tagRelation } from "@trader/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";

// Типы для графа
interface GraphNode {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  size: number; // Количество упоминаний (для визуализации)
  sentiment: number; // Средний sentiment
  metadata?: {
    aliases?: string[];
    totalMentions?: number;
    lastSeenAt?: string;
  };
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number; // Сила связи
  coOccurrences: number;
}

interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Cluster {
  id: string;
  name: string;
  nodes: string[];
  centralNode: string;
  avgSentiment: number;
  totalMentions: number;
}

export const graphBuilderService = {
  // Построение графа для всех активных тегов
  async buildGraph(options?: {
    minStrength?: number;
    maxNodes?: number;
    periodDays?: number;
    tagType?: string;
  }): Promise<Graph> {
    const {
      minStrength = 0.1,
      maxNodes = 100,
      periodDays = 7,
      tagType,
    } = options || {};

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - periodDays);

    // Получаем теги с активностью
    let tagsQuery = db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        subtype: newsTag.subtype,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
        aliases: newsTag.aliases,
        lastSeenAt: newsTag.lastSeenAt,
      })
      .from(newsTag)
      .where(gte(newsTag.lastSeenAt, periodStart))
      .orderBy(desc(sql`${newsTag.totalMentions}::numeric`))
      .limit(maxNodes);

    if (tagType) {
      tagsQuery = db
        .select({
          id: newsTag.id,
          name: newsTag.name,
          type: newsTag.type,
          subtype: newsTag.subtype,
          totalMentions: newsTag.totalMentions,
          avgSentiment: newsTag.avgSentiment,
          aliases: newsTag.aliases,
          lastSeenAt: newsTag.lastSeenAt,
        })
        .from(newsTag)
        .where(
          and(
            gte(newsTag.lastSeenAt, periodStart),
            eq(newsTag.type, tagType as "entity" | "topic" | "event" | "region")
          )
        )
        .orderBy(desc(sql`${newsTag.totalMentions}::numeric`))
        .limit(maxNodes);
    }

    const tags = await tagsQuery;
    const tagIds = tags.map((t) => t.id);

    // Формируем узлы
    const nodes: GraphNode[] = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      type: tag.type,
      subtype: tag.subtype,
      size: Number(tag.totalMentions) || 1,
      sentiment: Number(tag.avgSentiment) || 0,
      metadata: {
        aliases: tag.aliases || [],
        totalMentions: Number(tag.totalMentions) || 0,
        lastSeenAt: tag.lastSeenAt?.toISOString(),
      },
    }));

    // Получаем связи между этими тегами
    if (tagIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    const relations = await db
      .select({
        sourceTagId: tagRelation.sourceTagId,
        targetTagId: tagRelation.targetTagId,
        relationType: tagRelation.relationType,
        strength: tagRelation.strength,
        coOccurrenceCount: tagRelation.coOccurrenceCount,
      })
      .from(tagRelation)
      .where(
        and(
          sql`${tagRelation.sourceTagId} IN (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          sql`${tagRelation.targetTagId} IN (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          gte(sql`${tagRelation.strength}::numeric`, minStrength)
        )
      );

    // Формируем рёбра
    const edges: GraphEdge[] = relations.map((rel) => ({
      source: rel.sourceTagId,
      target: rel.targetTagId,
      type: rel.relationType,
      weight: Number(rel.strength) || 0,
      coOccurrences: Number(rel.coOccurrenceCount) || 0,
    }));

    return { nodes, edges };
  },

  // Построение эго-графа для конкретного тега
  async buildEgoGraph(
    tagId: string,
    depth = 2,
    minStrength = 0.05
  ): Promise<Graph> {
    const visitedNodes = new Set<string>();
    const nodesToProcess = [tagId];
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    let currentDepth = 0;

    while (currentDepth < depth && nodesToProcess.length > 0) {
      const currentBatch = [...nodesToProcess];
      nodesToProcess.length = 0;

      for (const nodeId of currentBatch) {
        if (visitedNodes.has(nodeId)) continue;
        visitedNodes.add(nodeId);

        // Получаем данные тега
        const [tag] = await db
          .select({
            id: newsTag.id,
            name: newsTag.name,
            type: newsTag.type,
            subtype: newsTag.subtype,
            totalMentions: newsTag.totalMentions,
            avgSentiment: newsTag.avgSentiment,
          })
          .from(newsTag)
          .where(eq(newsTag.id, nodeId));

        if (tag) {
          nodes.push({
            id: tag.id,
            name: tag.name,
            type: tag.type,
            subtype: tag.subtype,
            size: Number(tag.totalMentions) || 1,
            sentiment: Number(tag.avgSentiment) || 0,
          });
        }

        // Получаем связи (исходящие и входящие)
        const outgoingRelations = await db
          .select({
            targetTagId: tagRelation.targetTagId,
            relationType: tagRelation.relationType,
            strength: tagRelation.strength,
            coOccurrenceCount: tagRelation.coOccurrenceCount,
          })
          .from(tagRelation)
          .where(
            and(
              eq(tagRelation.sourceTagId, nodeId),
              gte(sql`${tagRelation.strength}::numeric`, minStrength)
            )
          );

        const incomingRelations = await db
          .select({
            sourceTagId: tagRelation.sourceTagId,
            relationType: tagRelation.relationType,
            strength: tagRelation.strength,
            coOccurrenceCount: tagRelation.coOccurrenceCount,
          })
          .from(tagRelation)
          .where(
            and(
              eq(tagRelation.targetTagId, nodeId),
              gte(sql`${tagRelation.strength}::numeric`, minStrength)
            )
          );

        for (const rel of outgoingRelations) {
          edges.push({
            source: nodeId,
            target: rel.targetTagId,
            type: rel.relationType,
            weight: Number(rel.strength) || 0,
            coOccurrences: Number(rel.coOccurrenceCount) || 0,
          });
          if (!visitedNodes.has(rel.targetTagId)) {
            nodesToProcess.push(rel.targetTagId);
          }
        }

        for (const rel of incomingRelations) {
          edges.push({
            source: rel.sourceTagId,
            target: nodeId,
            type: rel.relationType,
            weight: Number(rel.strength) || 0,
            coOccurrences: Number(rel.coOccurrenceCount) || 0,
          });
          if (!visitedNodes.has(rel.sourceTagId)) {
            nodesToProcess.push(rel.sourceTagId);
          }
        }
      }

      currentDepth++;
    }

    // Удаляем дубликаты рёбер
    const uniqueEdges = edges.filter(
      (edge, index, self) =>
        index ===
        self.findIndex(
          (e) =>
            (e.source === edge.source && e.target === edge.target) ||
            (e.source === edge.target && e.target === edge.source)
        )
    );

    return { nodes, edges: uniqueEdges };
  },

  // Обновление силы связей на основе co-occurrence
  async updateRelationStrengths(): Promise<number> {
    // Получаем максимальное количество co-occurrence для нормализации
    const [maxCoOccurrence] = await db
      .select({
        max: sql<number>`MAX(${tagRelation.coOccurrenceCount}::numeric)`,
      })
      .from(tagRelation);

    const maxValue = maxCoOccurrence?.max || 1;

    // Обновляем strength как нормализованное значение co-occurrence
    const result = await db.execute(sql`
      UPDATE tag_relation
      SET 
        strength = LEAST(1.0, (co_occurrence_count::numeric / ${maxValue})::numeric(5,4) + 0.1),
        updated_at = NOW()
      WHERE co_occurrence_count IS NOT NULL AND co_occurrence_count::numeric > 0
    `);

    return result.rowCount || 0;
  },

  // Вычисление центральности узлов (степенная центральность)
  async calculateCentrality(): Promise<
    { tagId: string; name: string; centrality: number }[]
  > {
    const result = await db.execute(sql`
      WITH degree_centrality AS (
        SELECT 
          tag_id,
          (outgoing + incoming) as total_degree
        FROM (
          SELECT 
            nt.id as tag_id,
            COUNT(DISTINCT tr1.id) as outgoing,
            COUNT(DISTINCT tr2.id) as incoming
          FROM news_tag nt
          LEFT JOIN tag_relation tr1 ON tr1.source_tag_id = nt.id
          LEFT JOIN tag_relation tr2 ON tr2.target_tag_id = nt.id
          GROUP BY nt.id
        ) degrees
      ),
      max_degree AS (
        SELECT MAX(total_degree) as max_val FROM degree_centrality
      )
      SELECT 
        dc.tag_id,
        nt.name,
        CASE 
          WHEN md.max_val > 0 THEN (dc.total_degree::numeric / md.max_val::numeric)
          ELSE 0
        END as centrality
      FROM degree_centrality dc
      JOIN news_tag nt ON nt.id = dc.tag_id
      CROSS JOIN max_degree md
      WHERE dc.total_degree > 0
      ORDER BY centrality DESC
      LIMIT 50
    `);

    return (
      result.rows as Array<{ tag_id: string; name: string; centrality: string }>
    ).map((r) => ({
      tagId: r.tag_id,
      name: r.name,
      centrality: Number(r.centrality),
    }));
  },

  // Простая кластеризация на основе компонент связности
  async detectClusters(minClusterSize = 3): Promise<Cluster[]> {
    // Получаем все связи
    const relations = await db
      .select({
        sourceTagId: tagRelation.sourceTagId,
        targetTagId: tagRelation.targetTagId,
      })
      .from(tagRelation)
      .where(gte(sql`${tagRelation.strength}::numeric`, 0.2));

    // Получаем все теги
    const tags = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
      })
      .from(newsTag);

    const tagMap = new Map(tags.map((t) => [t.id, t]));

    // Union-Find для компонент связности
    const parent = new Map<string, string>();
    const rank = new Map<string, number>();

    function find(x: string): string {
      if (!parent.has(x)) {
        parent.set(x, x);
        rank.set(x, 0);
      }
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x)!));
      }
      return parent.get(x)!;
    }

    function union(x: string, y: string): void {
      const rootX = find(x);
      const rootY = find(y);
      if (rootX !== rootY) {
        const rankX = rank.get(rootX) || 0;
        const rankY = rank.get(rootY) || 0;
        if (rankX < rankY) {
          parent.set(rootX, rootY);
        } else if (rankX > rankY) {
          parent.set(rootY, rootX);
        } else {
          parent.set(rootY, rootX);
          rank.set(rootX, rankX + 1);
        }
      }
    }

    // Объединяем связанные теги
    for (const rel of relations) {
      union(rel.sourceTagId, rel.targetTagId);
    }

    // Группируем по компонентам
    const components = new Map<string, string[]>();
    for (const [tagId] of parent) {
      const root = find(tagId);
      if (!components.has(root)) {
        components.set(root, []);
      }
      components.get(root)!.push(tagId);
    }

    // Формируем кластеры
    const clusters: Cluster[] = [];
    let clusterId = 0;

    for (const [, nodeIds] of components) {
      if (nodeIds.length < minClusterSize) continue;

      // Находим центральный узел (с максимальным количеством упоминаний)
      let centralNode = nodeIds[0];
      let maxMentions = 0;
      let totalSentiment = 0;
      let totalMentions = 0;

      for (const nodeId of nodeIds) {
        const tag = tagMap.get(nodeId);
        if (tag) {
          const mentions = Number(tag.totalMentions) || 0;
          if (mentions > maxMentions) {
            maxMentions = mentions;
            centralNode = nodeId;
          }
          totalSentiment += Number(tag.avgSentiment) || 0;
          totalMentions += mentions;
        }
      }

      const centralTag = tagMap.get(centralNode);

      clusters.push({
        id: `cluster_${clusterId++}`,
        name: centralTag?.name || `Cluster ${clusterId}`,
        nodes: nodeIds,
        centralNode,
        avgSentiment: nodeIds.length > 0 ? totalSentiment / nodeIds.length : 0,
        totalMentions,
      });
    }

    // Сортируем по размеру
    clusters.sort((a, b) => b.nodes.length - a.nodes.length);

    return clusters;
  },

  // Получение статистики графа
  async getGraphStats(): Promise<{
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;
    density: number;
    topCentralNodes: { tagId: string; name: string; degree: number }[];
  }> {
    const [nodeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(newsTag);

    const [edgeCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tagRelation);

    const totalNodes = nodeCount?.count || 0;
    const totalEdges = edgeCount?.count || 0;

    const avgDegree = totalNodes > 0 ? (2 * totalEdges) / totalNodes : 0;
    const maxPossibleEdges =
      totalNodes > 1 ? (totalNodes * (totalNodes - 1)) / 2 : 0;
    const density = maxPossibleEdges > 0 ? totalEdges / maxPossibleEdges : 0;

    // Топ узлы по степени
    const topNodes = await db.execute(sql`
      SELECT 
        nt.id as tag_id,
        nt.name,
        (COUNT(DISTINCT tr1.id) + COUNT(DISTINCT tr2.id)) as degree
      FROM news_tag nt
      LEFT JOIN tag_relation tr1 ON tr1.source_tag_id = nt.id
      LEFT JOIN tag_relation tr2 ON tr2.target_tag_id = nt.id
      GROUP BY nt.id, nt.name
      HAVING (COUNT(DISTINCT tr1.id) + COUNT(DISTINCT tr2.id)) > 0
      ORDER BY degree DESC
      LIMIT 10
    `);

    return {
      totalNodes,
      totalEdges,
      avgDegree,
      density,
      topCentralNodes: (
        topNodes.rows as Array<{ tag_id: string; name: string; degree: string }>
      ).map((r) => ({
        tagId: r.tag_id,
        name: r.name,
        degree: Number(r.degree),
      })),
    };
  },

  // Построение графа на определённую дату (Time Travel)
  async buildGraphAtTime(
    targetDate: Date,
    options?: {
      minStrength?: number;
      maxNodes?: number;
    }
  ): Promise<Graph> {
    const { minStrength = 0.1, maxNodes = 100 } = options || {};

    // Get tags that existed at that time (based on first seen or created)
    const tags = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        subtype: newsTag.subtype,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
        aliases: newsTag.aliases,
        createdAt: newsTag.createdAt,
      })
      .from(newsTag)
      .where(sql`${newsTag.createdAt} <= ${targetDate}`)
      .orderBy(desc(sql`${newsTag.totalMentions}::numeric`))
      .limit(maxNodes);

    const tagIds = tags.map((t) => t.id);

    if (tagIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    // Get relations that existed at that time
    const relations = await db
      .select({
        sourceTagId: tagRelation.sourceTagId,
        targetTagId: tagRelation.targetTagId,
        relationType: tagRelation.relationType,
        strength: tagRelation.strength,
        coOccurrenceCount: tagRelation.coOccurrenceCount,
        createdAt: tagRelation.createdAt,
      })
      .from(tagRelation)
      .where(
        and(
          sql`${tagRelation.sourceTagId} IN (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          sql`${tagRelation.targetTagId} IN (${sql.join(
            tagIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          gte(sql`${tagRelation.strength}::numeric`, minStrength),
          sql`${tagRelation.createdAt} <= ${targetDate}`
        )
      );

    const nodes: GraphNode[] = tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      type: tag.type,
      subtype: tag.subtype,
      size: Number(tag.totalMentions) || 1,
      sentiment: Number(tag.avgSentiment) || 0,
      metadata: {
        aliases: tag.aliases || [],
        totalMentions: Number(tag.totalMentions) || 0,
      },
    }));

    const edges: GraphEdge[] = relations.map((rel) => ({
      source: rel.sourceTagId,
      target: rel.targetTagId,
      type: rel.relationType,
      weight: Number(rel.strength) || 0,
      coOccurrences: Number(rel.coOccurrenceCount) || 0,
    }));

    return { nodes, edges };
  },

  // Get key dates for time slider (dates with significant activity)
  async getKeyDates(
    periodDays = 30
  ): Promise<{ date: Date; eventCount: number; description: string }[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - periodDays);

    const result = await db.execute(sql`
      WITH daily_activity AS (
        SELECT 
          DATE_TRUNC('day', ta.created_at) as day,
          COUNT(*) as alert_count,
          MAX(ta.title) as sample_title
        FROM trend_alert ta
        WHERE ta.created_at >= ${startDate}
          AND ta.severity IN ('high', 'critical')
        GROUP BY DATE_TRUNC('day', ta.created_at)
        HAVING COUNT(*) >= 2
      )
      SELECT 
        day,
        alert_count,
        sample_title
      FROM daily_activity
      ORDER BY day DESC
      LIMIT 10
    `);

    return (
      result.rows as Array<{
        day: Date;
        alert_count: string;
        sample_title: string;
      }>
    ).map((r) => ({
      date: new Date(r.day),
      eventCount: Number(r.alert_count),
      description: r.sample_title || "Significant activity",
    }));
  },

  // Get graph diff between two dates
  async getGraphDiff(
    fromDate: Date,
    toDate: Date,
    options?: { maxNodes?: number }
  ): Promise<{
    addedNodes: GraphNode[];
    removedNodes: GraphNode[];
    addedEdges: GraphEdge[];
    removedEdges: GraphEdge[];
    changedNodes: {
      node: GraphNode;
      mentionsDelta: number;
      sentimentDelta: number;
    }[];
  }> {
    const graphFrom = await this.buildGraphAtTime(fromDate, options);
    const graphTo = await this.buildGraphAtTime(toDate, options);

    const fromNodeIds = new Set(graphFrom.nodes.map((n) => n.id));
    const toNodeIds = new Set(graphTo.nodes.map((n) => n.id));
    const fromEdgeKeys = new Set(
      graphFrom.edges.map((e) => `${e.source}-${e.target}`)
    );
    const toEdgeKeys = new Set(
      graphTo.edges.map((e) => `${e.source}-${e.target}`)
    );

    const addedNodes = graphTo.nodes.filter((n) => !fromNodeIds.has(n.id));
    const removedNodes = graphFrom.nodes.filter((n) => !toNodeIds.has(n.id));

    const addedEdges = graphTo.edges.filter(
      (e) => !fromEdgeKeys.has(`${e.source}-${e.target}`)
    );
    const removedEdges = graphFrom.edges.filter(
      (e) => !toEdgeKeys.has(`${e.source}-${e.target}`)
    );

    // Find nodes that exist in both but have changed
    const fromNodeMap = new Map(graphFrom.nodes.map((n) => [n.id, n]));
    const changedNodes = graphTo.nodes
      .filter((n) => fromNodeIds.has(n.id))
      .map((n) => {
        const fromNode = fromNodeMap.get(n.id)!;
        return {
          node: n,
          mentionsDelta: n.size - fromNode.size,
          sentimentDelta: n.sentiment - fromNode.sentiment,
        };
      })
      .filter(
        (c) => Math.abs(c.mentionsDelta) > 0 || Math.abs(c.sentimentDelta) > 0.1
      );

    return {
      addedNodes,
      removedNodes,
      addedEdges,
      removedEdges,
      changedNodes,
    };
  },
};
