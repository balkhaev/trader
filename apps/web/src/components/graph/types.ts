// Types for 3D Graph Intelligence Platform

export interface GraphNode {
  id: string;
  name: string;
  type: "entity" | "topic" | "event" | "region";
  subtype: string | null;
  size: number; // Based on mentions/importance
  sentiment: number; // -1 to 1
  metadata?: {
    aliases?: string[];
    totalMentions?: number;
    lastSeenAt?: string;
  };
  // 3D positioning (set by force-graph)
  x?: number;
  y?: number;
  z?: number;
  // Visual state
  highlighted?: boolean;
  selected?: boolean;
}

export interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number; // 0-1 strength
  coOccurrences: number;
  // Visual state
  highlighted?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphPath {
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalWeight: number;
  depth: number;
}

export interface Cluster {
  id: string;
  name: string;
  nodes: string[];
  centralNode: string;
  avgSentiment: number;
  totalMentions: number;
}

export interface TimelinePoint {
  periodStart: string;
  periodEnd: string;
  mentionCount: number;
  avgSentiment: number;
  velocityChange: number;
}

export interface AIInsight {
  id: string;
  type: "cluster_analysis" | "anomaly" | "prediction" | "entity_summary";
  title: string;
  content: string;
  confidence: number;
  relatedEntities: string[];
  createdAt: string;
}

// Color scheme for node types
export const NODE_COLORS: Record<string, string> = {
  entity: "#3b82f6", // Blue
  topic: "#a855f7", // Purple
  event: "#f59e0b", // Amber
  region: "#10b981", // Emerald
};

// Brighter colors for highlights
export const NODE_COLORS_BRIGHT: Record<string, string> = {
  entity: "#60a5fa",
  topic: "#c084fc",
  event: "#fbbf24",
  region: "#34d399",
};

// Edge colors by type
export const EDGE_COLORS: Record<string, string> = {
  co_occurrence: "#475569",
  causal: "#f59e0b",
  temporal: "#06b6d4",
  hierarchical: "#8b5cf6",
  competitive: "#ef4444",
  partnership: "#22c55e",
};
