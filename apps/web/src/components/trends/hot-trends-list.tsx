"use client";

import {
  Building2,
  Calendar,
  Flame,
  Globe,
  Lightbulb,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { type HotTrend, useHotTrends } from "@/hooks/use-trends";
import { cn } from "@/lib/utils";

interface HotTrendsListProps {
  onSelectTag?: (tagId: string) => void;
}

const typeIcons: Record<string, React.ReactNode> = {
  entity: <Building2 className="h-4 w-4" />,
  topic: <Lightbulb className="h-4 w-4" />,
  event: <Calendar className="h-4 w-4" />,
  region: <Globe className="h-4 w-4" />,
};

const typeColors: Record<string, string> = {
  entity: "text-blue-500",
  topic: "text-purple-500",
  event: "text-orange-500",
  region: "text-green-500",
};

function getSentimentColor(sentiment: number | null): string {
  if (sentiment === null) return "text-muted-foreground";
  if (sentiment > 0.3) return "text-green-500";
  if (sentiment < -0.3) return "text-red-500";
  return "text-yellow-500";
}

function getGrowthIcon(growth: number) {
  if (growth > 10) return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (growth < -10) return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function TrendItem({
  trend,
  rank,
  onClick,
}: {
  trend: HotTrend;
  rank: number;
  onClick?: () => void;
}) {
  const isHot = trend.growthPercent > 100;

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50",
        isHot && "border-orange-500/30 bg-orange-500/5"
      )}
      onClick={onClick}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted font-mono text-muted-foreground text-sm">
        {rank}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={typeColors[trend.tagType]}>
            {typeIcons[trend.tagType]}
          </span>
          <span className="truncate font-medium">{trend.tagName}</span>
          {isHot && <Flame className="h-4 w-4 text-orange-500" />}
        </div>
        <div className="mt-1 flex items-center gap-2 text-muted-foreground text-xs">
          <span>{trend.mentionCount} упоминаний</span>
          <span>•</span>
          <span>{trend.uniqueSources} источников</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {getGrowthIcon(trend.growthPercent)}
          <span
            className={cn(
              "font-mono text-sm",
              trend.growthPercent > 0 ? "text-green-500" : "text-red-500"
            )}
          >
            {trend.growthPercent > 0 ? "+" : ""}
            {trend.growthPercent.toFixed(0)}%
          </span>
        </div>
        {trend.avgSentiment !== null && (
          <span
            className={cn(
              "font-mono text-xs",
              getSentimentColor(trend.avgSentiment)
            )}
          >
            {trend.avgSentiment > 0 ? "+" : ""}
            {trend.avgSentiment.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

export function HotTrendsList({ onSelectTag }: HotTrendsListProps) {
  const [period, setPeriod] = useState<"1h" | "24h" | "7d">("24h");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const {
    data: trends,
    isLoading,
    error,
  } = useHotTrends({
    period,
    limit: 20,
    type:
      typeFilter === "all"
        ? undefined
        : (typeFilter as "entity" | "topic" | "event" | "region"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-orange-500" />
          Горячие тренды
        </CardTitle>
        <div className="flex gap-2">
          <Select onValueChange={setTypeFilter} value={typeFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Тип" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              <SelectItem value="entity">Сущности</SelectItem>
              <SelectItem value="topic">Темы</SelectItem>
              <SelectItem value="event">События</SelectItem>
              <SelectItem value="region">Регионы</SelectItem>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(v) => setPeriod(v as typeof period)}
            value={period}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1 час</SelectItem>
              <SelectItem value="24h">24 часа</SelectItem>
              <SelectItem value="7d">7 дней</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div className="flex items-center gap-3 p-3" key={i}>
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="mb-2 h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="py-4 text-center text-destructive text-sm">
            Ошибка загрузки трендов
          </p>
        ) : trends?.length ? (
          <div className="space-y-2">
            {trends.map((trend, index) => (
              <TrendItem
                key={trend.tagId}
                onClick={() => onSelectTag?.(trend.tagId)}
                rank={index + 1}
                trend={trend}
              />
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-muted-foreground text-sm">
            Нет данных о трендах
          </p>
        )}
      </CardContent>
    </Card>
  );
}
