"use client";

import { formatDistanceToNow } from "date-fns";
import { Clock, Pause, Play, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCollectMarketData, useSchedulerControl } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

export function SchedulerControl() {
  const { start, stop, status } = useSchedulerControl();
  const collectMutation = useCollectMarketData();

  const isRunning = status.data?.isRunning ?? false;
  const lastRun = status.data?.lastRun ?? {};

  const formatLastRun = (dateStr: string | undefined) => {
    if (!dateStr) return "Never";
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return "Unknown";
    }
  };

  const handleManualCollect = () => {
    collectMutation.mutate({ timeframe: "1h", topCount: 50, limit: 200 });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Scheduler
          </span>
          <Badge
            className={cn(isRunning && "bg-green-500")}
            variant={isRunning ? "default" : "secondary"}
          >
            {isRunning ? "Running" : "Stopped"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {isRunning ? (
            <Button
              className="flex-1"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
              size="sm"
              variant="destructive"
            >
              <Pause className="mr-2 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              className="flex-1"
              disabled={start.isPending}
              onClick={() => start.mutate()}
              size="sm"
              variant="default"
            >
              <Play className="mr-2 h-4 w-4" />
              Start
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={collectMutation.isPending}
            onClick={handleManualCollect}
            size="sm"
            variant="outline"
          >
            <RefreshCw
              className={cn(
                "mr-2 h-4 w-4",
                collectMutation.isPending && "animate-spin"
              )}
            />
            Collect Now
          </Button>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">1H Candles:</span>
            <span>{formatLastRun(lastRun.collect1h)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">4H Candles:</span>
            <span>{formatLastRun(lastRun.collect4h)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Analysis:</span>
            <span>{formatLastRun(lastRun.analyze)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Opportunities:</span>
            <span>{formatLastRun(lastRun.opportunities)}</span>
          </div>
        </div>

        {collectMutation.isSuccess && (
          <p className="text-green-500 text-xs">
            Collected {collectMutation.data.totalCandles} candles for{" "}
            {collectMutation.data.totalAssets} assets
          </p>
        )}
        {collectMutation.isError && (
          <p className="text-red-500 text-xs">
            {collectMutation.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
