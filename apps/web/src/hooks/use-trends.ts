import { useCallback, useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Types
export interface Tag {
  id: string;
  name: string;
  type: "entity" | "topic" | "event" | "region";
  subtype: string | null;
  totalMentions: number;
  avgSentiment: number;
  lastSeenAt: string | null;
  aliases: string[];
}

export interface HotTrend {
  tag: {
    id: string;
    name: string;
    type: string;
  };
  metrics: {
    mentionCount: number;
    velocityChange: number;
    avgSentiment: number;
  };
}

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  subtype: string | null;
  size: number;
  sentiment: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  coOccurrences: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Cluster {
  id: string;
  name: string;
  nodes: string[];
  centralNode: string;
  avgSentiment: number;
  totalMentions: number;
}

export interface Alert {
  id: string;
  tagId: string;
  tagName: string;
  alertType: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  metrics: Record<string, number> | null;
  acknowledged: boolean;
  createdAt: string;
}

export interface TrendStats {
  tags: {
    totalTags: number;
    byType: Record<string, number>;
    topTags: { name: string; type: string; mentions: number }[];
  };
  graph: {
    totalNodes: number;
    totalEdges: number;
    avgDegree: number;
    density: number;
    topCentralNodes: { tagId: string; name: string; degree: number }[];
  };
  alerts: {
    total: number;
    unacknowledged: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    last24h: number;
  };
}

export interface TimelinePoint {
  periodStart: string;
  periodEnd: string;
  mentionCount: number;
  avgSentiment: number;
  velocityChange: number;
}

// Hook для списка тегов
export function useTags(options?: {
  type?: string;
  search?: string;
  minMentions?: number;
  limit?: number;
  orderBy?: "mentions" | "sentiment" | "lastSeen";
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (options?.type) params.set("type", options.type);
      if (options?.search) params.set("search", options.search);
      if (options?.minMentions)
        params.set("minMentions", options.minMentions.toString());
      if (options?.limit) params.set("limit", options.limit.toString());
      if (options?.orderBy) params.set("orderBy", options.orderBy);

      const res = await fetch(`${API_BASE}/api/trends/tags?${params}`);
      const json = await res.json();
      setTags(json.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tags");
    } finally {
      setLoading(false);
    }
  }, [
    options?.type,
    options?.search,
    options?.minMentions,
    options?.limit,
    options?.orderBy,
  ]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  return { tags, loading, error, refetch: fetchTags };
}

// Hook для горячих трендов
export function useHotTrends(period: "1h" | "24h" | "7d" = "24h", limit = 20) {
  const [trends, setTrends] = useState<HotTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHotTrends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/trends/hot?period=${period}&limit=${limit}`
      );
      const json = await res.json();
      setTrends(json || []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch hot trends"
      );
    } finally {
      setLoading(false);
    }
  }, [period, limit]);

  useEffect(() => {
    fetchHotTrends();
  }, [fetchHotTrends]);

  return { trends, loading, error, refetch: fetchHotTrends };
}

// Hook для графа
export function useGraph(options?: {
  minStrength?: number;
  maxNodes?: number;
  periodDays?: number;
  tagType?: string;
}) {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (options?.minStrength)
        params.set("minStrength", options.minStrength.toString());
      if (options?.maxNodes)
        params.set("maxNodes", options.maxNodes.toString());
      if (options?.periodDays)
        params.set("periodDays", options.periodDays.toString());
      if (options?.tagType) params.set("tagType", options.tagType);

      const res = await fetch(`${API_BASE}/api/trends/graph?${params}`);
      const json = await res.json();
      setGraph(json || { nodes: [], edges: [] });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph");
    } finally {
      setLoading(false);
    }
  }, [
    options?.minStrength,
    options?.maxNodes,
    options?.periodDays,
    options?.tagType,
  ]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return { graph, loading, error, refetch: fetchGraph };
}

// Hook для кластеров
export function useClusters(minClusterSize = 3) {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClusters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/trends/graph/clusters?minClusterSize=${minClusterSize}`
      );
      const json = await res.json();
      setClusters(json || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch clusters");
    } finally {
      setLoading(false);
    }
  }, [minClusterSize]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  return { clusters, loading, error, refetch: fetchClusters };
}

// Hook для алертов
export function useAlerts(options?: {
  severity?: string;
  type?: string;
  unacknowledged?: boolean;
  limit?: number;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (options?.severity) params.set("severity", options.severity);
      if (options?.type) params.set("type", options.type);
      if (options?.unacknowledged) params.set("unacknowledged", "true");
      if (options?.limit) params.set("limit", options.limit.toString());

      const res = await fetch(`${API_BASE}/api/trends/alerts?${params}`);
      const json = await res.json();
      setAlerts(json || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch alerts");
    } finally {
      setLoading(false);
    }
  }, [
    options?.severity,
    options?.type,
    options?.unacknowledged,
    options?.limit,
  ]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const acknowledgeAlert = async (alertId: string) => {
    try {
      await fetch(`${API_BASE}/api/trends/alerts/${alertId}/acknowledge`, {
        method: "POST",
      });
      fetchAlerts();
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  return { alerts, loading, error, refetch: fetchAlerts, acknowledgeAlert };
}

// Hook для статистики
export function useTrendStats() {
  const [stats, setStats] = useState<TrendStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trends/stats`);
      const json = await res.json();
      setStats(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
}

// Hook для деталей тега
export function useTagDetails(tagId: string | null) {
  const [tag, setTag] = useState<Tag | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTagDetails = useCallback(async () => {
    if (!tagId) {
      setTag(null);
      setTimeline([]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trends/tags/${tagId}`);
      const json = await res.json();
      setTag(json.tag);
      setTimeline(json.timeline || []);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch tag details"
      );
    } finally {
      setLoading(false);
    }
  }, [tagId]);

  useEffect(() => {
    fetchTagDetails();
  }, [fetchTagDetails]);

  return { tag, timeline, loading, error, refetch: fetchTagDetails };
}
