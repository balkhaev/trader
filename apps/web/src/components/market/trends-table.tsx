"use client";

import { Activity, ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MarketAsset, MarketTrend } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

interface TrendsTableProps {
  trends?: Array<MarketTrend & { asset: MarketAsset }>;
  isLoading?: boolean;
  title?: string;
  limit?: number;
}

const trendIcons: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  uptrend: TrendingUp,
  downtrend: TrendingDown,
  sideways: ArrowRight,
  breakout_up: TrendingUp,
  breakout_down: TrendingDown,
  reversal_bullish: TrendingUp,
  reversal_bearish: TrendingDown,
};

const trendColors: Record<string, string> = {
  uptrend: "text-green-500",
  downtrend: "text-red-500",
  sideways: "text-yellow-500",
  breakout_up: "text-emerald-500",
  breakout_down: "text-rose-500",
  reversal_bullish: "text-green-400",
  reversal_bearish: "text-red-400",
};

const strengthColors: Record<string, string> = {
  weak: "bg-gray-500/10 text-gray-500",
  moderate: "bg-yellow-500/10 text-yellow-500",
  strong: "bg-green-500/10 text-green-500",
  very_strong: "bg-emerald-500/10 text-emerald-500",
};

export function TrendsTable({
  trends,
  isLoading,
  title = "Active Trends",
  limit = 10,
}: TrendsTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton className="h-12 w-full" key={i} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayTrends = trends?.slice(0, limit) || [];

  if (displayTrends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-muted-foreground text-sm">
            No active trends found
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Trend</TableHead>
              <TableHead>Strength</TableHead>
              <TableHead className="hidden md:table-cell">
                Price Change
              </TableHead>
              <TableHead className="hidden md:table-cell">Confidence</TableHead>
              <TableHead className="hidden lg:table-cell">Timeframe</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayTrends.map((trend) => {
              const TrendIcon = trendIcons[trend.trendType] || Activity;
              const trendColor =
                trendColors[trend.trendType] || "text-muted-foreground";
              const strengthClass = strengthColors[trend.strength] || "";

              return (
                <TableRow key={trend.id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col">
                      <span>{trend.asset.symbol}</span>
                      <span className="text-muted-foreground text-xs">
                        {trend.asset.sector}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className={cn("flex items-center gap-2", trendColor)}>
                      <TrendIcon className="h-4 w-4" />
                      <span className="text-sm capitalize">
                        {trend.trendType.replace("_", " ")}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={cn("capitalize", strengthClass)}
                      variant="outline"
                    >
                      {trend.strength.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {trend.priceChange ? (
                      <span
                        className={cn(
                          "font-medium",
                          Number(trend.priceChange) >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        )}
                      >
                        {Number(trend.priceChange) >= 0 ? "+" : ""}
                        {Number(trend.priceChange).toFixed(2)}%
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${Number(trend.confidence) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-muted-foreground text-xs">
                        {(Number(trend.confidence) * 100).toFixed(0)}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <Badge variant="secondary">{trend.timeframe}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
