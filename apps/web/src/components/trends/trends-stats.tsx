"use client";

import {
  AlertTriangle,
  Building2,
  Calendar,
  Globe,
  Hash,
  Lightbulb,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrendsStats } from "@/hooks/use-trends";

const typeIcons: Record<string, React.ReactNode> = {
  entity: <Building2 className="h-3 w-3" />,
  topic: <Lightbulb className="h-3 w-3" />,
  event: <Calendar className="h-3 w-3" />,
  region: <Globe className="h-3 w-3" />,
};

const typeColors: Record<string, string> = {
  entity: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  topic: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  event: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  region: "bg-green-500/10 text-green-500 border-green-500/20",
};

export function TrendsStats() {
  const { data: stats, isLoading, error } = useTrendsStats();

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
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card className="border-destructive">
        <CardContent className="pt-6">
          <p className="text-destructive text-sm">Ошибка загрузки статистики</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">Всего тегов</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{stats.totalTags}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Всего упоминаний
            </CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{stats.totalMentions}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">За 24 часа</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">{stats.mentionsLast24h}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="font-medium text-sm">
              Активных алертов
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl">
              {stats.activeAlerts}
              {stats.activeAlerts > 0 && (
                <span className="ml-2 text-muted-foreground text-sm">
                  / {stats.totalAlerts}
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {Object.keys(stats.typeDistribution).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-medium text-sm">
              Распределение по типам
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(stats.typeDistribution).map(([type, count]) => (
                <Badge
                  className={`${typeColors[type] || ""} gap-1`}
                  key={type}
                  variant="outline"
                >
                  {typeIcons[type]}
                  <span className="capitalize">{type}</span>
                  <span className="ml-1 font-mono">{count}</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
