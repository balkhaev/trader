"use client";

import {
  Activity,
  AlertTriangle,
  GitBranch,
  Hash,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTrendStats } from "@/hooks/use-trends";
import { AlertsFeed } from "./alerts-feed";
import { HotTrends } from "./hot-trends";
import { RelationsGraph } from "./relations-graph";
import { TagCloud } from "./tag-cloud";

export function TrendsDashboard() {
  const { stats, loading } = useTrendStats();

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm text-zinc-400">
              Total Tags
            </CardTitle>
            <Hash className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl text-zinc-100">
              {loading ? "..." : stats?.tags.totalTags.toLocaleString()}
            </div>
            <p className="text-muted-foreground text-xs">
              {stats?.tags.byType.entity || 0} entities,{" "}
              {stats?.tags.byType.topic || 0} topics
            </p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm text-zinc-400">
              Graph Connections
            </CardTitle>
            <GitBranch className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl text-zinc-100">
              {loading ? "..." : stats?.graph.totalEdges.toLocaleString()}
            </div>
            <p className="text-muted-foreground text-xs">
              Avg degree: {stats?.graph.avgDegree.toFixed(2) || 0}
            </p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm text-zinc-400">
              Active Alerts
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl text-zinc-100">
              {loading ? "..." : stats?.alerts.unacknowledged}
            </div>
            <p className="text-muted-foreground text-xs">
              {stats?.alerts.last24h || 0} in last 24h
            </p>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm text-zinc-400">
              Network Density
            </CardTitle>
            <Activity className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl text-zinc-100">
              {loading
                ? "..."
                : `${((stats?.graph.density || 0) * 100).toFixed(2)}%`}
            </div>
            <p className="text-muted-foreground text-xs">Connection density</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs className="space-y-4" defaultValue="hot">
        <TabsList className="grid w-full grid-cols-4 bg-zinc-800/50">
          <TabsTrigger
            className="data-[state=active]:bg-emerald-600"
            value="hot"
          >
            <TrendingUp className="mr-2 h-4 w-4" />
            Hot Trends
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-emerald-600"
            value="cloud"
          >
            <Hash className="mr-2 h-4 w-4" />
            Tag Cloud
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-emerald-600"
            value="graph"
          >
            <GitBranch className="mr-2 h-4 w-4" />
            Relations
          </TabsTrigger>
          <TabsTrigger
            className="data-[state=active]:bg-emerald-600"
            value="alerts"
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-4" value="hot">
          <HotTrends />
        </TabsContent>

        <TabsContent className="space-y-4" value="cloud">
          <TagCloud />
        </TabsContent>

        <TabsContent className="space-y-4" value="graph">
          <RelationsGraph />
        </TabsContent>

        <TabsContent className="space-y-4" value="alerts">
          <AlertsFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
}
