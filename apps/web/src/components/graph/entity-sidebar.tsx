"use client";

import {
  ArrowRight,
  GitBranch,
  Hash,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { AIInsight, GraphEdge, GraphNode, TimelinePoint } from "./types";
import { NODE_COLORS } from "./types";

interface EntitySidebarProps {
  node: GraphNode | null;
  connections?: {
    node: GraphNode;
    edge: GraphEdge;
  }[];
  timeline?: TimelinePoint[];
  insights?: AIInsight[];
  loading?: boolean;
  insightsLoading?: boolean;
  onClose?: () => void;
  onNodeClick?: (node: GraphNode) => void;
  onFindPath?: (targetId: string) => void;
  onAnalyze?: () => void;
}

export function EntitySidebar({
  node,
  connections = [],
  timeline = [],
  insights = [],
  loading,
  insightsLoading,
  onClose,
  onNodeClick,
  onFindPath,
  onAnalyze,
}: EntitySidebarProps) {
  if (!node) {
    return (
      <div className="flex h-full w-80 flex-col border-zinc-800 border-l bg-zinc-900/95">
        <div className="flex h-full items-center justify-center p-6 text-center text-zinc-500">
          <div>
            <GitBranch className="mx-auto mb-3 h-12 w-12 opacity-30" />
            <p className="font-mono text-sm">Select a node to view details</p>
          </div>
        </div>
      </div>
    );
  }

  const sentimentColor =
    node.sentiment > 0.2
      ? "text-emerald-400"
      : node.sentiment < -0.2
        ? "text-red-400"
        : "text-zinc-400";

  const sentimentBg =
    node.sentiment > 0.2
      ? "bg-emerald-500/10 border-emerald-500/30"
      : node.sentiment < -0.2
        ? "bg-red-500/10 border-red-500/30"
        : "bg-zinc-500/10 border-zinc-500/30";

  return (
    <div className="flex h-full w-80 flex-col border-zinc-800 border-l bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-start justify-between border-zinc-800 border-b p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <div
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: NODE_COLORS[node.type] }}
            />
            <h2 className="font-semibold text-lg text-zinc-100">{node.name}</h2>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Badge
              className="border-zinc-700 font-mono text-xs text-zinc-400"
              variant="outline"
            >
              {node.type}
            </Badge>
            {node.subtype && (
              <Badge
                className="border-zinc-700 font-mono text-xs text-zinc-400"
                variant="outline"
              >
                {node.subtype}
              </Badge>
            )}
          </div>
        </div>
        <Button
          className="h-8 w-8 text-zinc-500 hover:text-zinc-100"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-4">
          {/* Stats */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-800/50 p-3">
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <Hash className="h-3 w-3" />
                Mentions
              </div>
              <div className="mt-1 font-mono text-lg text-zinc-100">
                {node.metadata?.totalMentions?.toLocaleString() || node.size}
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${sentimentBg}`}>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                {node.sentiment > 0 ? (
                  <TrendingUp className="h-3 w-3" />
                ) : (
                  <TrendingDown className="h-3 w-3" />
                )}
                Sentiment
              </div>
              <div className={`mt-1 font-mono text-lg ${sentimentColor}`}>
                {node.sentiment > 0 ? "+" : ""}
                {node.sentiment.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Aliases */}
          {node.metadata?.aliases && node.metadata.aliases.length > 0 && (
            <div>
              <h3 className="mb-2 font-medium font-mono text-xs text-zinc-500">
                ALIASES
              </h3>
              <div className="flex flex-wrap gap-1">
                {node.metadata.aliases.map((alias, i) => (
                  <Badge
                    className="border-zinc-700 text-xs text-zinc-400"
                    key={i}
                    variant="outline"
                  >
                    {alias}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Connections */}
          <div>
            <h3 className="mb-2 font-medium font-mono text-xs text-zinc-500">
              CONNECTIONS ({connections.length})
            </h3>
            {loading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => (
                  <Skeleton className="h-10 w-full" key={i} />
                ))}
              </div>
            ) : connections.length === 0 ? (
              <div className="py-4 text-center text-sm text-zinc-600">
                No connections found
              </div>
            ) : (
              <div className="space-y-1">
                {connections.slice(0, 10).map(({ node: connNode, edge }) => (
                  <div
                    className="group flex cursor-pointer items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/30 p-2 transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
                    key={connNode.id}
                    onClick={() => onNodeClick?.(connNode)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: NODE_COLORS[connNode.type] }}
                      />
                      <span className="text-sm text-zinc-300">
                        {connNode.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-zinc-500">
                        {(edge.weight * 100).toFixed(0)}%
                      </span>
                      <Button
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFindPath?.(connNode.id);
                        }}
                        size="icon"
                        title="Find path"
                        variant="ghost"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
                {connections.length > 10 && (
                  <div className="py-2 text-center text-xs text-zinc-500">
                    +{connections.length - 10} more connections
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Timeline */}
          {timeline.length > 0 && (
            <div>
              <h3 className="mb-2 font-medium font-mono text-xs text-zinc-500">
                ACTIVITY (24H)
              </h3>
              <div className="flex h-16 items-end gap-px">
                {timeline.map((point, i) => {
                  const maxMentions = Math.max(
                    ...timeline.map((t) => t.mentionCount)
                  );
                  const height =
                    maxMentions > 0
                      ? (point.mentionCount / maxMentions) * 100
                      : 0;
                  return (
                    <div
                      className="flex-1 rounded-t bg-blue-500/50 transition-all hover:bg-blue-500"
                      key={i}
                      style={{ height: `${Math.max(2, height)}%` }}
                      title={`${point.mentionCount} mentions`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* AI Insights */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-medium font-mono text-xs text-zinc-500">
                AI INSIGHTS
              </h3>
              <Button
                className="h-6 px-2 text-amber-500 text-xs hover:text-amber-400"
                disabled={insightsLoading}
                onClick={onAnalyze}
                size="sm"
                variant="ghost"
              >
                <Sparkles className="mr-1 h-3 w-3" />
                Analyze
              </Button>
            </div>
            {insightsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
              </div>
            ) : insights.length === 0 ? (
              <div className="rounded-lg border border-zinc-700 border-dashed p-4 text-center text-sm text-zinc-600">
                Click "Analyze" to generate AI insights
              </div>
            ) : (
              <div className="space-y-2">
                {insights.map((insight) => (
                  <div
                    className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                    key={insight.id}
                  >
                    <div className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-4 w-4 text-amber-500" />
                      <div>
                        <div className="font-medium text-sm text-zinc-200">
                          {insight.title}
                        </div>
                        <div className="mt-1 text-xs text-zinc-400">
                          {insight.content}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Last seen */}
          {node.metadata?.lastSeenAt && (
            <div className="border-zinc-800 border-t pt-4">
              <div className="text-xs text-zinc-500">
                Last seen: {new Date(node.metadata.lastSeenAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
