"use client";

import { ArrowDown, ArrowUp, Flame } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHotTrends } from "@/hooks/use-trends";
import { cn } from "@/lib/utils";

const periodOptions = [
  { value: "1h", label: "1 Hour" },
  { value: "24h", label: "24 Hours" },
  { value: "7d", label: "7 Days" },
] as const;

function getSentimentColor(sentiment: number): string {
  if (sentiment >= 0.5) return "text-emerald-400";
  if (sentiment >= 0.2) return "text-emerald-500/70";
  if (sentiment >= -0.2) return "text-zinc-400";
  if (sentiment >= -0.5) return "text-red-500/70";
  return "text-red-400";
}

function getGrowthBadge(growth: number) {
  if (growth > 0) {
    return (
      <Badge
        className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
        variant="outline"
      >
        <ArrowUp className="mr-1 h-3 w-3" />
        {growth.toFixed(0)}%
      </Badge>
    );
  }
  if (growth < 0) {
    return (
      <Badge
        className="border-red-500/30 bg-red-500/10 text-red-400"
        variant="outline"
      >
        <ArrowDown className="mr-1 h-3 w-3" />
        {Math.abs(growth).toFixed(0)}%
      </Badge>
    );
  }
  return (
    <Badge className="text-zinc-400" variant="outline">
      0%
    </Badge>
  );
}

function getTypeColor(type: string): string {
  switch (type) {
    case "entity":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "topic":
      return "bg-purple-500/20 text-purple-400 border-purple-500/30";
    case "event":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "region":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    default:
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  }
}

export function HotTrends() {
  const [period, setPeriod] = useState<"1h" | "24h" | "7d">("24h");
  const { trends, loading, error, refetch } = useHotTrends(period, 20);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-zinc-100">Hot Trends</CardTitle>
          </div>
          <div className="flex gap-1">
            {periodOptions.map((option) => (
              <Button
                className={cn(
                  "h-7 text-xs",
                  period === option.value
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "text-zinc-400 hover:text-zinc-100"
                )}
                key={option.value}
                onClick={() => setPeriod(option.value)}
                size="sm"
                variant={period === option.value ? "default" : "ghost"}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
        <CardDescription className="text-zinc-500">
          Tags with the highest growth rate in mentions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800 p-3"
                key={i}
              >
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-zinc-500">
            <p>Failed to load trends</p>
            <Button
              className="mt-2"
              onClick={refetch}
              size="sm"
              variant="ghost"
            >
              Retry
            </Button>
          </div>
        ) : trends.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            No trending tags found for this period
          </div>
        ) : (
          <div className="space-y-2">
            {trends.map((trend, index) => (
              <div
                className={cn(
                  "group flex items-center justify-between gap-4 rounded-lg border border-zinc-800 p-3 transition-all hover:border-zinc-700 hover:bg-zinc-800/50",
                  index < 3 && "border-orange-500/20 bg-orange-500/5"
                )}
                key={trend.tag.id}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full font-mono text-xs",
                      index < 3
                        ? "bg-orange-500/20 text-orange-400"
                        : "bg-zinc-800 text-zinc-400"
                    )}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-zinc-100">
                        {trend.tag.name}
                      </span>
                      <Badge
                        className={cn("text-xs", getTypeColor(trend.tag.type))}
                        variant="outline"
                      >
                        {trend.tag.type}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <span>{trend.metrics.mentionCount} mentions</span>
                      <span>•</span>
                      <span
                        className={getSentimentColor(
                          trend.metrics.avgSentiment
                        )}
                      >
                        Sentiment: {trend.metrics.avgSentiment.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {getGrowthBadge(trend.metrics.velocityChange)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
