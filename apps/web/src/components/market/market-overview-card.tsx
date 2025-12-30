"use client";

import {
  Activity,
  BarChart3,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarketOverview } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

interface MarketOverviewCardProps {
  data?: MarketOverview;
  isLoading?: boolean;
}

export function MarketOverviewCard({
  data,
  isLoading,
}: MarketOverviewCardProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="mb-2 h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const cards = [
    {
      title: "Total Assets",
      value: data.summary.totalAssets,
      description: Object.entries(data.summary.byMarket)
        .map(([type, count]) => `${count} ${type}`)
        .join(", "),
      icon: BarChart3,
      color: "text-blue-500",
    },
    {
      title: "Active Trends",
      value: data.summary.activeTrends,
      description: "Detected market trends",
      icon: Activity,
      color: "text-purple-500",
    },
    {
      title: "Opportunities",
      value: data.summary.activeOpportunities,
      description: "Investment opportunities",
      icon: Target,
      color: "text-emerald-500",
    },
    {
      title: "Scheduler",
      value: data.scheduler.isRunning ? "Running" : "Stopped",
      description: data.scheduler.isRunning
        ? "Auto-collecting data"
        : "Manual mode",
      icon: data.scheduler.isRunning ? TrendingUp : TrendingDown,
      color: data.scheduler.isRunning ? "text-green-500" : "text-red-500",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">{card.title}</CardTitle>
            <card.icon className={cn("h-4 w-4", card.color)} />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{card.value}</div>
            <p className="truncate text-muted-foreground text-xs">
              {card.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
