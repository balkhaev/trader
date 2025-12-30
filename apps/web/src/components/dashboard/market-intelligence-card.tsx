"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatProbabilityChange,
  getAlignmentColor,
  getSentimentColor,
  useMarketIntelligence,
} from "@/hooks/use-polymarket";
import { cn } from "@/lib/utils";

export function MarketIntelligenceCard() {
  const { data, loading, error } = useMarketIntelligence();

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-purple-500" />
            Market Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-yellow-500">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">Не удалось загрузить данные</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-purple-500" />
          Market Intelligence
          <Badge className="ml-auto" variant="secondary">
            Polymarket
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <MarketIntelligenceSkeleton />
        ) : data ? (
          <>
            {/* Overall Alignment */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                Общий Alignment
              </span>
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      data.overallAlignment >= 0.3
                        ? "bg-green-500"
                        : data.overallAlignment >= -0.3
                          ? "bg-yellow-500"
                          : "bg-red-500"
                    )}
                    style={{
                      width: `${Math.abs(data.overallAlignment) * 50 + 50}%`,
                    }}
                  />
                </div>
                <span
                  className={cn(
                    "font-medium text-sm",
                    getAlignmentColor(data.overallAlignment)
                  )}
                >
                  {data.overallAlignment >= 0 ? "+" : ""}
                  {data.overallAlignment.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Sentiment Distribution */}
            <div className="space-y-2">
              <span className="text-muted-foreground text-sm">
                Smart Money Sentiment
              </span>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span>{data.sentimentDistribution.bullish} bullish</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <span>{data.sentimentDistribution.bearish} bearish</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded-full bg-gray-400" />
                  <span>{data.sentimentDistribution.neutral} neutral</span>
                </div>
              </div>
            </div>

            {/* Avg Probability Change */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                Avg Probability Change (24h)
              </span>
              <span
                className={cn(
                  "flex items-center gap-1 font-medium text-sm",
                  data.avgProbabilityChange >= 0
                    ? "text-green-500"
                    : "text-red-500"
                )}
              >
                {data.avgProbabilityChange >= 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : (
                  <ArrowDown className="h-3 w-3" />
                )}
                {formatProbabilityChange(data.avgProbabilityChange)}
              </span>
            </div>

            {/* Top Correlated Event */}
            {data.topCorrelatedEvent && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-purple-500" />
                  <span className="font-medium text-sm">Top Event</span>
                </div>
                <p className="line-clamp-2 text-muted-foreground text-xs">
                  {data.topCorrelatedEvent.question}
                </p>
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {Math.round(data.topCorrelatedEvent.probability * 100)}%
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      data.topCorrelatedEvent.change24h >= 0
                        ? "text-green-500"
                        : "text-red-500"
                    )}
                  >
                    {data.topCorrelatedEvent.change24h >= 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {formatProbabilityChange(data.topCorrelatedEvent.change24h)}
                  </span>
                </div>
              </div>
            )}

            {/* Smart Money Signals Preview */}
            {data.smartMoneySignals.length > 0 && (
              <div className="space-y-2">
                <span className="text-muted-foreground text-xs">
                  Smart Money Signals
                </span>
                <div className="flex flex-wrap gap-2">
                  {data.smartMoneySignals.slice(0, 3).map((signal, i) => (
                    <Badge
                      className={cn(
                        "capitalize",
                        getSentimentColor(signal.sentiment)
                      )}
                      key={i}
                      variant="outline"
                    >
                      {signal.sentiment}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="flex items-center justify-between border-t pt-3 text-muted-foreground text-xs">
              <span>{data.stats.totalEvents} events</span>
              <span>{data.stats.activeMarkets} active markets</span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MarketIntelligenceSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}
