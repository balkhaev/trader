import { useCallback, useEffect, useState } from "react";
import type {
  AIInsight,
  Graph,
  GraphEdge,
  GraphNode,
  GraphPath,
} from "@/components/graph/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

interface UseGraphOptions {
  minStrength?: number;
  maxNodes?: number;
  periodDays?: number;
  types?: string[];
}

export function useGraphData(options: UseGraphOptions = {}) {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (options.minStrength !== undefined)
        params.set("minStrength", options.minStrength.toString());
      if (options.maxNodes !== undefined)
        params.set("maxNodes", options.maxNodes.toString());
      if (options.periodDays !== undefined)
        params.set("periodDays", options.periodDays.toString());

      // Filter by types if specified
      if (options.types && options.types.length < 4) {
        for (const type of options.types) {
          params.append("tagType", type);
        }
      }

      const res = await fetch(`${API_BASE}/api/trends/graph?${params}`);
      if (!res.ok) throw new Error("Failed to fetch graph");

      const data = await res.json();
      setGraph({
        nodes: data.nodes || [],
        edges: data.edges || [],
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch graph");
    } finally {
      setLoading(false);
    }
  }, [
    options.minStrength,
    options.maxNodes,
    options.periodDays,
    options.types?.join(","),
  ]);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  return { graph, loading, error, refetch: fetchGraph };
}

export function useEgoGraph(
  nodeId: string | null,
  depth = 2,
  minStrength = 0.05
) {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEgoGraph = useCallback(async () => {
    if (!nodeId) {
      setGraph({ nodes: [], edges: [] });
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        depth: depth.toString(),
        minStrength: minStrength.toString(),
      });

      const res = await fetch(
        `${API_BASE}/api/trends/tags/${nodeId}/graph?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch ego graph");

      const data = await res.json();
      setGraph({
        nodes: data.nodes || [],
        edges: data.edges || [],
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch ego graph"
      );
    } finally {
      setLoading(false);
    }
  }, [nodeId, depth, minStrength]);

  useEffect(() => {
    fetchEgoGraph();
  }, [fetchEgoGraph]);

  return { graph, loading, error, refetch: fetchEgoGraph };
}

export function useNodeConnections(nodeId: string | null) {
  const [connections, setConnections] = useState<
    { node: GraphNode; edge: GraphEdge }[]
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!nodeId) {
      setConnections([]);
      return;
    }

    const fetchConnections = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/trends/tags/${nodeId}/graph?depth=1&minStrength=0.01`
        );
        if (!res.ok) throw new Error("Failed to fetch connections");

        const data = await res.json();
        const nodes = new Map<string, GraphNode>(
          (data.nodes || []).map((n: GraphNode) => [n.id, n])
        );

        const edges = data.edges || [];
        const result: { node: GraphNode; edge: GraphEdge }[] = [];

        for (const edge of edges) {
          const sourceId =
            typeof edge.source === "string" ? edge.source : edge.source.id;
          const targetId =
            typeof edge.target === "string" ? edge.target : edge.target.id;

          if (sourceId === nodeId && nodes.has(targetId)) {
            result.push({ node: nodes.get(targetId)!, edge });
          } else if (targetId === nodeId && nodes.has(sourceId)) {
            result.push({ node: nodes.get(sourceId)!, edge });
          }
        }

        // Sort by weight descending
        result.sort((a, b) => b.edge.weight - a.edge.weight);
        setConnections(result);
      } catch {
        setConnections([]);
      } finally {
        setLoading(false);
      }
    };

    fetchConnections();
  }, [nodeId]);

  return { connections, loading };
}

export function useFindPath(
  fromId: string | null,
  toId: string | null,
  maxDepth = 4
) {
  const [path, setPath] = useState<GraphPath | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findPath = useCallback(async () => {
    if (!(fromId && toId)) {
      setPath(null);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        from: fromId,
        to: toId,
        maxDepth: maxDepth.toString(),
      });

      const res = await fetch(`${API_BASE}/api/trends/graph/path?${params}`);
      if (!res.ok) {
        if (res.status === 404) {
          setPath(null);
          setError("No path found between these entities");
          return;
        }
        throw new Error("Failed to find path");
      }

      const data = await res.json();
      setPath(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to find path");
      setPath(null);
    } finally {
      setLoading(false);
    }
  }, [fromId, toId, maxDepth]);

  useEffect(() => {
    if (fromId && toId) {
      findPath();
    }
  }, [findPath, fromId, toId]);

  return { path, loading, error, refetch: findPath };
}

export function useHistoricalGraph(
  date: Date | null,
  options: UseGraphOptions = {}
) {
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistoricalGraph = useCallback(async () => {
    if (!date) {
      setGraph({ nodes: [], edges: [] });
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        date: date.toISOString(),
      });
      if (options.minStrength !== undefined)
        params.set("minStrength", options.minStrength.toString());
      if (options.maxNodes !== undefined)
        params.set("maxNodes", options.maxNodes.toString());

      const res = await fetch(
        `${API_BASE}/api/trends/graph/historical?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch historical graph");

      const data = await res.json();
      setGraph({
        nodes: data.nodes || [],
        edges: data.edges || [],
      });
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch historical graph"
      );
    } finally {
      setLoading(false);
    }
  }, [date?.toISOString(), options.minStrength, options.maxNodes]);

  useEffect(() => {
    fetchHistoricalGraph();
  }, [fetchHistoricalGraph]);

  return { graph, loading, error, refetch: fetchHistoricalGraph };
}

export function useAIInsights(entityId: string | null) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!entityId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/trends/insights/entity/${entityId}`,
        {
          method: "POST",
        }
      );
      if (!res.ok) throw new Error("Failed to analyze entity");

      const data = await res.json();
      setInsights(data.insights || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  return { insights, loading, error, analyze };
}

export function useClusterInsights(clusterId: string | null) {
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    if (!clusterId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/trends/insights/cluster/${clusterId}`,
        {
          method: "POST",
        }
      );
      if (!res.ok) throw new Error("Failed to analyze cluster");

      const data = await res.json();
      setInsights(data.insights || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  return { insights, loading, error, analyze };
}
