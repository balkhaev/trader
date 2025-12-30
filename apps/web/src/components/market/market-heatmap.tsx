"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { HeatmapItem } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

interface MarketHeatmapProps {
  data?: HeatmapItem[];
  bySector?: Record<string, HeatmapItem[]>;
  isLoading?: boolean;
}

function getColorForChange(change: number): string {
  if (change >= 10) return "bg-green-600";
  if (change >= 5) return "bg-green-500";
  if (change >= 2) return "bg-green-400";
  if (change >= 0.5) return "bg-green-300/70";
  if (change > -0.5) return "bg-gray-400/50";
  if (change >= -2) return "bg-red-300/70";
  if (change >= -5) return "bg-red-400";
  if (change >= -10) return "bg-red-500";
  return "bg-red-600";
}

function HeatmapCell({ item }: { item: HeatmapItem }) {
  const bgColor = getColorForChange(item.priceChange);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center rounded p-2 text-white transition-all hover:z-10 hover:scale-105",
        bgColor
      )}
      title={`${item.symbol}: ${item.priceChange >= 0 ? "+" : ""}${item.priceChange.toFixed(2)}%`}
    >
      <span className="max-w-full truncate font-bold text-xs">
        {item.symbol.replace("USDT", "")}
      </span>
      <span className="text-[10px] opacity-90">
        {item.priceChange >= 0 ? "+" : ""}
        {item.priceChange.toFixed(1)}%
      </span>
    </div>
  );
}

export function MarketHeatmap({
  data,
  bySector,
  isLoading,
}: MarketHeatmapProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: 40 }).map((_, i) => (
              <Skeleton className="h-12" key={i} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Market Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-muted-foreground text-sm">
            No market data available. Start the scheduler to collect data.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sort by absolute change for visual impact
  const sortedData = [...data].sort(
    (a, b) => Math.abs(b.priceChange) - Math.abs(a.priceChange)
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span>Market Heatmap</span>
          <div className="flex items-center gap-2 font-normal text-muted-foreground text-xs">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-green-500" />
              <span>Gainers</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-red-500" />
              <span>Losers</span>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {bySector && Object.keys(bySector).length > 0 ? (
          <div className="space-y-4">
            {Object.entries(bySector).map(([sector, items]) => (
              <div key={sector}>
                <h4 className="mb-2 font-medium text-muted-foreground text-sm capitalize">
                  {sector}
                </h4>
                <div className="grid grid-cols-6 gap-1 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
                  {items
                    .sort(
                      (a, b) =>
                        Math.abs(b.priceChange) - Math.abs(a.priceChange)
                    )
                    .map((item) => (
                      <HeatmapCell item={item} key={item.symbol} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12">
            {sortedData.map((item) => (
              <HeatmapCell item={item} key={item.symbol} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
