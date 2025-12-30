"use client";

import {
  Activity,
  Calendar,
  GitBranch,
  Route,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  EntitySidebar,
  Graph3D,
  GraphControls,
  PathFinderPanel,
  TimeSlider,
} from "@/components/graph";
import type { GraphNode, GraphPath } from "@/components/graph/types";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useAIInsights,
  useGraphData,
  useHistoricalGraph,
  useNodeConnections,
} from "@/hooks/use-graph";
import { useHotTrends, useTagDetails } from "@/hooks/use-trends";

type SidebarMode = "details" | "pathfinder";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function IntelligencePage() {
  // Graph state
  const [filters, setFilters] = useState({
    types: ["entity", "topic", "event", "region"],
    minStrength: 0.1,
    maxNodes: 100,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("details");
  const [lastUpdated, setLastUpdated] = useState<string>("");

  // Time travel state
  const [isTimeTravel, setIsTimeTravel] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [keyDates, setKeyDates] = useState<
    { date: Date; eventCount: number; description: string }[]
  >([]);

  // Data hooks
  const {
    graph: liveGraph,
    loading: liveLoading,
    refetch,
  } = useGraphData({
    minStrength: filters.minStrength,
    maxNodes: filters.maxNodes,
    types: filters.types,
    periodDays: 7,
  });

  const { graph: historicalGraph, loading: historicalLoading } =
    useHistoricalGraph(isTimeTravel ? currentDate : null, {
      minStrength: filters.minStrength,
      maxNodes: filters.maxNodes,
    });

  // Use historical or live graph
  const graph = isTimeTravel ? historicalGraph : liveGraph;
  const loading = isTimeTravel ? historicalLoading : liveLoading;

  const { connections, loading: connectionsLoading } =
    useNodeConnections(selectedNodeId);
  const { timeline } = useTagDetails(selectedNodeId);
  const {
    insights,
    loading: insightsLoading,
    analyze,
  } = useAIInsights(selectedNodeId);
  const { trends } = useHotTrends("24h", 5);

  // Update last updated time on client only
  useEffect(() => {
    setLastUpdated(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      if (!isTimeTravel) {
        setLastUpdated(new Date().toLocaleTimeString());
      }
    }, 30_000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, [isTimeTravel]);

  // Fetch key dates for time slider
  useEffect(() => {
    const fetchKeyDates = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/trends/graph/key-dates?periodDays=30`
        );
        const data = await res.json();
        setKeyDates(
          (data.keyDates || []).map(
            (kd: {
              date: string;
              eventCount: number;
              description: string;
            }) => ({
              ...kd,
              date: new Date(kd.date),
            })
          )
        );
      } catch {
        // Ignore errors
      }
    };
    fetchKeyDates();
  }, []);

  // Find selected node
  const selectedNode = selectedNodeId
    ? graph.nodes.find((n) => n.id === selectedNodeId) || null
    : null;

  // Handlers
  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNodeId(node.id);
    setHighlightedPath([]);
    setSidebarMode("details");
  }, []);

  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    // Open path finder with this node as source
    setSelectedNodeId(node.id);
    setSidebarMode("pathfinder");
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      const matchingNode = graph.nodes.find((n) =>
        n.name.toLowerCase().includes(query.toLowerCase())
      );
      if (matchingNode) {
        setSelectedNodeId(matchingNode.id);
      }
    },
    [graph.nodes]
  );

  const handleFindPath = useCallback((targetId: string) => {
    setSidebarMode("pathfinder");
  }, []);

  const handlePathFound = useCallback((path: GraphPath) => {
    setHighlightedPath(path.nodes.map((n) => n.id));
  }, []);

  const handleCloseSidebar = useCallback(() => {
    setSelectedNodeId(null);
    setHighlightedPath([]);
  }, []);

  const handleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const handleDateChange = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  // Stats
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const avgDegree =
    nodeCount > 0 ? ((edgeCount * 2) / nodeCount).toFixed(1) : "0";

  return (
    <div
      className={`flex h-screen flex-col bg-[#0a0a0a] ${isFullscreen ? "fixed inset-0 z-50" : ""}`}
    >
      {/* Bloomberg-style header */}
      <header className="flex items-center justify-between border-zinc-800 border-b bg-zinc-900/80 px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-amber-500" />
            <h1 className="font-bold font-mono text-lg text-zinc-100">
              INTELLIGENCE
            </h1>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <div className="flex items-center gap-1.5">
              <div
                className={`h-2 w-2 rounded-full ${
                  isTimeTravel ? "bg-amber-500" : "animate-pulse bg-emerald-500"
                }`}
              />
              <span className="text-zinc-500">
                {isTimeTravel ? "HISTORICAL" : "LIVE"}
              </span>
            </div>
            <div className="text-zinc-600">|</div>
            <div className="text-zinc-400">
              <span className="text-zinc-500">NODES:</span>{" "}
              <span className="text-emerald-400">{nodeCount}</span>
            </div>
            <div className="text-zinc-400">
              <span className="text-zinc-500">EDGES:</span>{" "}
              <span className="text-blue-400">{edgeCount}</span>
            </div>
            <div className="text-zinc-400">
              <span className="text-zinc-500">AVG°:</span>{" "}
              <span className="text-purple-400">{avgDegree}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Time travel toggle */}
          <Button
            className={`gap-2 font-mono text-xs ${
              isTimeTravel
                ? "bg-amber-500 text-black hover:bg-amber-400"
                : "text-zinc-400"
            }`}
            onClick={() => setIsTimeTravel(!isTimeTravel)}
            size="sm"
            variant={isTimeTravel ? "default" : "ghost"}
          >
            <Calendar className="h-4 w-4" />
            Time Travel
          </Button>

          {/* Hot trends ticker */}
          <div className="flex items-center gap-3">
            <TrendingUp className="h-4 w-4 text-amber-500" />
            <div className="flex items-center gap-2 overflow-hidden">
              {trends.slice(0, 3).map((trend) => (
                <div
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 font-mono text-xs"
                  key={trend.tag.id}
                >
                  <span className="text-zinc-400">{trend.tag.name}</span>
                  <span
                    className={
                      trend.metrics.velocityChange > 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }
                  >
                    {trend.metrics.velocityChange > 0 ? "+" : ""}
                    {trend.metrics.velocityChange.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Time slider (when active) */}
      {isTimeTravel && (
        <div className="border-zinc-800 border-b px-4 py-3">
          <TimeSlider
            currentDate={currentDate}
            keyDates={keyDates}
            loading={historicalLoading}
            onDateChange={handleDateChange}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* Main graph panel */}
          <ResizablePanel defaultSize={75} minSize={50}>
            <div className="relative flex h-full flex-col">
              {/* Controls */}
              <div className="absolute top-4 left-4 z-10">
                <GraphControls
                  filters={filters}
                  isFullscreen={isFullscreen}
                  loading={loading}
                  onFiltersChange={setFilters}
                  onFullscreen={handleFullscreen}
                  onRefresh={refetch}
                  onSearch={handleSearch}
                />
              </div>

              {/* 3D Graph */}
              <Graph3D
                graph={graph}
                highlightedPath={highlightedPath}
                onNodeClick={handleNodeClick}
                onNodeDoubleClick={handleNodeDoubleClick}
                selectedNodeId={selectedNodeId}
                showLabels={nodeCount < 100}
              />

              {/* Bottom stats bar */}
              <div className="absolute right-0 bottom-0 left-0 flex items-center justify-between border-zinc-800 border-t bg-zinc-900/90 px-4 py-2 font-mono text-xs backdrop-blur">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-3 w-3 text-zinc-500" />
                    <span className="text-zinc-500">
                      {isTimeTravel
                        ? `Date: ${currentDate.toLocaleDateString()}`
                        : "Period: 7 days"}
                    </span>
                  </div>
                  <div className="text-zinc-600">|</div>
                  <div className="flex items-center gap-2">
                    <Zap className="h-3 w-3 text-amber-500" />
                    <span className="text-zinc-500">
                      Min strength: {(filters.minStrength * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="text-zinc-600">
                  {isTimeTravel
                    ? `Viewing: ${currentDate.toLocaleString()}`
                    : lastUpdated
                      ? `Last updated: ${lastUpdated}`
                      : "Loading..."}
                </div>
              </div>
            </div>
          </ResizablePanel>

          {/* Sidebar */}
          <ResizableHandle className="w-px bg-zinc-800 hover:bg-zinc-700" />
          <ResizablePanel defaultSize={25} maxSize={40} minSize={20}>
            <div className="flex h-full flex-col">
              {/* Sidebar mode tabs */}
              <div className="border-zinc-800 border-b p-2">
                <Tabs
                  onValueChange={(v) => setSidebarMode(v as SidebarMode)}
                  value={sidebarMode}
                >
                  <TabsList className="grid w-full grid-cols-2 bg-zinc-800/50">
                    <TabsTrigger
                      className="gap-2 font-mono text-xs data-[state=active]:bg-zinc-700"
                      value="details"
                    >
                      <GitBranch className="h-3 w-3" />
                      Details
                    </TabsTrigger>
                    <TabsTrigger
                      className="gap-2 font-mono text-xs data-[state=active]:bg-zinc-700"
                      value="pathfinder"
                    >
                      <Route className="h-3 w-3" />
                      Path Finder
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Sidebar content */}
              {sidebarMode === "details" ? (
                <EntitySidebar
                  connections={connections}
                  insights={insights}
                  insightsLoading={insightsLoading}
                  loading={connectionsLoading}
                  node={selectedNode}
                  onAnalyze={analyze}
                  onClose={handleCloseSidebar}
                  onFindPath={handleFindPath}
                  onNodeClick={handleNodeClick}
                  timeline={timeline}
                />
              ) : (
                <PathFinderPanel
                  nodes={graph.nodes}
                  onClose={() => setSidebarMode("details")}
                  onPathFound={handlePathFound}
                  selectedFromId={selectedNodeId}
                />
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
