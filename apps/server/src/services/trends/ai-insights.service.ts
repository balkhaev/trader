import { db, newsArticle, newsTag, tagMention, tagRelation } from "@trader/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { openaiService } from "../llm/openai.service";
import { graphBuilderService } from "./graph-builder.service";

interface AIInsight {
  id: string;
  type: "cluster_analysis" | "anomaly" | "prediction" | "entity_summary";
  title: string;
  content: string;
  confidence: number;
  relatedEntities: string[];
  createdAt: string;
}

interface EntityContext {
  entity: {
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    totalMentions: number;
    avgSentiment: number;
  };
  recentMentions: {
    articleTitle: string;
    context: string | null;
    sentiment: string | null;
    publishedAt: Date;
  }[];
  connections: {
    name: string;
    type: string;
    strength: number;
    relationType: string;
  }[];
}

interface ClusterContext {
  cluster: {
    id: string;
    name: string;
    nodeCount: number;
    avgSentiment: number;
    totalMentions: number;
  };
  nodes: {
    name: string;
    type: string;
    mentions: number;
    sentiment: number;
  }[];
  internalConnections: {
    source: string;
    target: string;
    strength: number;
    relationType: string;
  }[];
}

export const aiInsightsService = {
  /**
   * Generate AI insights for a specific entity
   */
  async analyzeEntity(entityId: string): Promise<{ insights: AIInsight[] }> {
    // Get entity context
    const context = await this.getEntityContext(entityId);
    if (!context) {
      return { insights: [] };
    }

    const prompt = this.buildEntityAnalysisPrompt(context);

    try {
      const response = await openaiService.chat({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial intelligence analyst specializing in crypto and market trends. 
Analyze the provided entity data and generate actionable insights.
Respond ONLY with valid JSON in the following format:
{
  "insights": [
    {
      "type": "entity_summary" | "anomaly" | "prediction",
      "title": "Short title",
      "content": "Detailed insight content",
      "confidence": 0.0-1.0,
      "relatedEntities": ["entity1", "entity2"]
    }
  ]
}`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      const insights: AIInsight[] = (parsed.insights || []).map(
        (insight: Omit<AIInsight, "id" | "createdAt">, index: number) => ({
          id: `insight_${entityId}_${index}`,
          type: insight.type,
          title: insight.title,
          content: insight.content,
          confidence: insight.confidence,
          relatedEntities: insight.relatedEntities || [],
          createdAt: new Date().toISOString(),
        })
      );

      return { insights };
    } catch (error) {
      console.error("AI Insights error:", error);
      return {
        insights: [
          {
            id: `insight_${entityId}_error`,
            type: "entity_summary",
            title: "Analysis unavailable",
            content: "Could not generate AI insights at this time.",
            confidence: 0,
            relatedEntities: [],
            createdAt: new Date().toISOString(),
          },
        ],
      };
    }
  },

  /**
   * Generate AI insights for a cluster of entities
   */
  async analyzeCluster(clusterId: string): Promise<{ insights: AIInsight[] }> {
    // Get cluster from graph builder
    const clusters = await graphBuilderService.detectClusters(2);
    const cluster = clusters.find((c) => c.id === clusterId);

    if (!cluster) {
      return { insights: [] };
    }

    const context = await this.getClusterContext(cluster);
    const prompt = this.buildClusterAnalysisPrompt(context);

    try {
      const response = await openaiService.chat({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial intelligence analyst specializing in identifying patterns and connections between market entities.
Analyze the provided cluster of related entities and generate insights about their relationships and significance.
Respond ONLY with valid JSON in the following format:
{
  "insights": [
    {
      "type": "cluster_analysis" | "prediction",
      "title": "Short title",
      "content": "Detailed insight about the cluster",
      "confidence": 0.0-1.0,
      "relatedEntities": ["entity1", "entity2"]
    }
  ]
}`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      const insights: AIInsight[] = (parsed.insights || []).map(
        (insight: Omit<AIInsight, "id" | "createdAt">, index: number) => ({
          id: `insight_cluster_${clusterId}_${index}`,
          type: insight.type,
          title: insight.title,
          content: insight.content,
          confidence: insight.confidence,
          relatedEntities: insight.relatedEntities || [],
          createdAt: new Date().toISOString(),
        })
      );

      return { insights };
    } catch (error) {
      console.error("Cluster AI Insights error:", error);
      return { insights: [] };
    }
  },

  /**
   * Analyze relationship between two entities
   */
  async analyzeRelationship(
    entityId1: string,
    entityId2: string
  ): Promise<{ insights: AIInsight[] }> {
    const [entity1, entity2] = await Promise.all([
      this.getEntityContext(entityId1),
      this.getEntityContext(entityId2),
    ]);

    if (!(entity1 && entity2)) {
      return { insights: [] };
    }

    // Find connections between them
    const { pathFinderService } = await import("./path-finder.service");
    const relationship = await pathFinderService.analyzeRelationship(
      entityId1,
      entityId2
    );

    const prompt = `Analyze the relationship between these two entities:

ENTITY 1: ${entity1.entity.name} (${entity1.entity.type})
- Mentions: ${entity1.entity.totalMentions}
- Sentiment: ${entity1.entity.avgSentiment.toFixed(2)}
- Top connections: ${entity1.connections
      .slice(0, 5)
      .map((c) => c.name)
      .join(", ")}

ENTITY 2: ${entity2.entity.name} (${entity2.entity.type})
- Mentions: ${entity2.entity.totalMentions}
- Sentiment: ${entity2.entity.avgSentiment.toFixed(2)}
- Top connections: ${entity2.connections
      .slice(0, 5)
      .map((c) => c.name)
      .join(", ")}

RELATIONSHIP DATA:
- Direct connection: ${relationship.directConnection ? `Yes (strength: ${relationship.directConnection.weight.toFixed(2)})` : "No"}
- Path length: ${relationship.shortestPath?.depth || "No path found"}
- Common neighbors: ${relationship.commonNeighbors.map((n) => n.name).join(", ") || "None"}
- Overall connection strength: ${relationship.connectionStrength.toFixed(2)}

Provide insights about:
1. Why these entities might be connected
2. The nature of their relationship
3. Potential implications for traders/investors`;

    try {
      const response = await openaiService.chat({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You analyze relationships between market entities.
Respond ONLY with valid JSON:
{
  "insights": [
    {
      "type": "cluster_analysis",
      "title": "Short title",
      "content": "Detailed relationship analysis",
      "confidence": 0.0-1.0,
      "relatedEntities": ["entity1", "entity2"]
    }
  ]
}`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      return {
        insights: (parsed.insights || []).map(
          (insight: Omit<AIInsight, "id" | "createdAt">, index: number) => ({
            id: `insight_rel_${entityId1}_${entityId2}_${index}`,
            ...insight,
            createdAt: new Date().toISOString(),
          })
        ),
      };
    } catch (error) {
      console.error("Relationship AI Insights error:", error);
      return { insights: [] };
    }
  },

  /**
   * Generate market-wide trend insights
   */
  async analyzeMarketTrends(): Promise<{ insights: AIInsight[] }> {
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);

    // Get top trending entities
    const topEntities = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
      })
      .from(newsTag)
      .where(gte(newsTag.lastSeenAt, periodStart))
      .orderBy(desc(sql`${newsTag.totalMentions}::numeric`))
      .limit(20);

    // Get clusters
    const clusters = await graphBuilderService.detectClusters(3);

    const prompt = `Analyze current market trends based on this data:

TOP TRENDING ENTITIES (last 7 days):
${topEntities
  .map(
    (e, i) =>
      `${i + 1}. ${e.name} (${e.type}) - ${e.totalMentions} mentions, sentiment: ${Number(e.avgSentiment).toFixed(2)}`
  )
  .join("\n")}

IDENTIFIED CLUSTERS:
${clusters
  .slice(0, 5)
  .map(
    (c) =>
      `- ${c.name}: ${c.nodes.length} entities, ${c.totalMentions} total mentions`
  )
  .join("\n")}

Provide 2-3 key insights about:
1. Dominant market narratives
2. Emerging trends or themes
3. Potential opportunities or risks`;

    try {
      const response = await openaiService.chat({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a market trends analyst. Provide actionable insights.
Respond ONLY with valid JSON:
{
  "insights": [
    {
      "type": "prediction",
      "title": "Short title",
      "content": "Trend insight",
      "confidence": 0.0-1.0,
      "relatedEntities": ["entity1", "entity2"]
    }
  ]
}`,
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(content);

      return {
        insights: (parsed.insights || []).map(
          (insight: Omit<AIInsight, "id" | "createdAt">, index: number) => ({
            id: `insight_market_${Date.now()}_${index}`,
            ...insight,
            createdAt: new Date().toISOString(),
          })
        ),
      };
    } catch (error) {
      console.error("Market trends AI Insights error:", error);
      return { insights: [] };
    }
  },

  // Helper methods

  async getEntityContext(entityId: string): Promise<EntityContext | null> {
    const [entity] = await db
      .select({
        id: newsTag.id,
        name: newsTag.name,
        type: newsTag.type,
        subtype: newsTag.subtype,
        totalMentions: newsTag.totalMentions,
        avgSentiment: newsTag.avgSentiment,
      })
      .from(newsTag)
      .where(eq(newsTag.id, entityId));

    if (!entity) return null;

    // Get recent mentions with article context
    const mentions = await db
      .select({
        articleTitle: newsArticle.title,
        context: tagMention.context,
        sentiment: tagMention.sentiment,
        publishedAt: newsArticle.publishedAt,
      })
      .from(tagMention)
      .innerJoin(newsArticle, eq(tagMention.articleId, newsArticle.id))
      .where(eq(tagMention.tagId, entityId))
      .orderBy(desc(newsArticle.publishedAt))
      .limit(10);

    // Get connections
    const relations = await db
      .select({
        targetTagId: tagRelation.targetTagId,
        sourceTagId: tagRelation.sourceTagId,
        strength: tagRelation.strength,
        relationType: tagRelation.relationType,
      })
      .from(tagRelation)
      .where(
        sql`${tagRelation.sourceTagId} = ${entityId} OR ${tagRelation.targetTagId} = ${entityId}`
      )
      .orderBy(desc(sql`${tagRelation.strength}::numeric`))
      .limit(20);

    // Get connected tag names
    const connectedIds = relations.map((r) =>
      r.sourceTagId === entityId ? r.targetTagId : r.sourceTagId
    );

    const connectedTags =
      connectedIds.length > 0
        ? await db
            .select({ id: newsTag.id, name: newsTag.name, type: newsTag.type })
            .from(newsTag)
            .where(
              sql`${newsTag.id} IN (${sql.join(
                connectedIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
        : [];

    const tagMap = new Map(connectedTags.map((t) => [t.id, t]));

    return {
      entity: {
        ...entity,
        totalMentions: Number(entity.totalMentions) || 0,
        avgSentiment: Number(entity.avgSentiment) || 0,
      },
      recentMentions: mentions,
      connections: relations.map((r) => {
        const connectedId =
          r.sourceTagId === entityId ? r.targetTagId : r.sourceTagId;
        const tag = tagMap.get(connectedId);
        return {
          name: tag?.name || "Unknown",
          type: tag?.type || "unknown",
          strength: Number(r.strength) || 0,
          relationType: r.relationType,
        };
      }),
    };
  },

  async getClusterContext(cluster: {
    id: string;
    name: string;
    nodes: string[];
    avgSentiment: number;
    totalMentions: number;
  }): Promise<ClusterContext> {
    const nodeIds = cluster.nodes.slice(0, 20);

    const nodes =
      nodeIds.length > 0
        ? await db
            .select({
              id: newsTag.id,
              name: newsTag.name,
              type: newsTag.type,
              totalMentions: newsTag.totalMentions,
              avgSentiment: newsTag.avgSentiment,
            })
            .from(newsTag)
            .where(
              sql`${newsTag.id} IN (${sql.join(
                nodeIds.map((id) => sql`${id}`),
                sql`, `
              )})`
            )
        : [];

    // Get internal connections
    const connections =
      nodeIds.length > 1
        ? await db
            .select({
              sourceTagId: tagRelation.sourceTagId,
              targetTagId: tagRelation.targetTagId,
              strength: tagRelation.strength,
              relationType: tagRelation.relationType,
            })
            .from(tagRelation)
            .where(
              and(
                sql`${tagRelation.sourceTagId} IN (${sql.join(
                  nodeIds.map((id) => sql`${id}`),
                  sql`, `
                )})`,
                sql`${tagRelation.targetTagId} IN (${sql.join(
                  nodeIds.map((id) => sql`${id}`),
                  sql`, `
                )})`
              )
            )
            .limit(50)
        : [];

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    return {
      cluster: {
        id: cluster.id,
        name: cluster.name,
        nodeCount: cluster.nodes.length,
        avgSentiment: cluster.avgSentiment,
        totalMentions: cluster.totalMentions,
      },
      nodes: nodes.map((n) => ({
        name: n.name,
        type: n.type,
        mentions: Number(n.totalMentions) || 0,
        sentiment: Number(n.avgSentiment) || 0,
      })),
      internalConnections: connections.map((c) => ({
        source: nodeMap.get(c.sourceTagId)?.name || "Unknown",
        target: nodeMap.get(c.targetTagId)?.name || "Unknown",
        strength: Number(c.strength) || 0,
        relationType: c.relationType,
      })),
    };
  },

  buildEntityAnalysisPrompt(context: EntityContext): string {
    return `Analyze this entity from the crypto/financial news landscape:

ENTITY: ${context.entity.name}
Type: ${context.entity.type}${context.entity.subtype ? ` (${context.entity.subtype})` : ""}
Total Mentions: ${context.entity.totalMentions}
Average Sentiment: ${context.entity.avgSentiment.toFixed(2)} (scale: -1 to 1)

RECENT MENTIONS:
${context.recentMentions
  .slice(0, 5)
  .map(
    (m) =>
      `- "${m.articleTitle}" (${m.sentiment || "neutral"})${m.context ? `: "${m.context.slice(0, 100)}..."` : ""}`
  )
  .join("\n")}

TOP CONNECTIONS (by strength):
${context.connections
  .slice(0, 10)
  .map(
    (c) =>
      `- ${c.name} (${c.type}): ${(c.strength * 100).toFixed(0)}% strength via ${c.relationType}`
  )
  .join("\n")}

Generate 1-2 insights about:
1. Current market perception of this entity
2. Notable patterns or anomalies in recent activity
3. Key relationships that might impact future developments`;
  },

  buildClusterAnalysisPrompt(context: ClusterContext): string {
    return `Analyze this cluster of related entities:

CLUSTER: ${context.cluster.name}
Size: ${context.cluster.nodeCount} entities
Total Mentions: ${context.cluster.totalMentions}
Average Sentiment: ${context.cluster.avgSentiment.toFixed(2)}

MEMBER ENTITIES:
${context.nodes
  .slice(0, 15)
  .map(
    (n) =>
      `- ${n.name} (${n.type}): ${n.mentions} mentions, sentiment ${n.sentiment.toFixed(2)}`
  )
  .join("\n")}

INTERNAL CONNECTIONS:
${context.internalConnections
  .slice(0, 10)
  .map(
    (c) =>
      `- ${c.source} ↔ ${c.target}: ${(c.strength * 100).toFixed(0)}% (${c.relationType})`
  )
  .join("\n")}

Generate 1-2 insights about:
1. What theme or narrative unifies this cluster
2. Why these entities are being discussed together
3. Potential market implications of this clustering`;
  },
};
