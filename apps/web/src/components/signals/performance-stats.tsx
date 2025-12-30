"use client";

import {
  ArrowDown,
  ArrowUp,
  Award,
  Clock,
  Target,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { PerformanceStats } from "@/hooks/use-signals";

interface PerformanceStatsCardProps {
  stats?: PerformanceStats;
  isLoading?: boolean;
}

function StatBox({
  icon: Icon,
  label,
  value,
  subvalue,
  valueColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subvalue?: string;
  valueColor?: "green" | "red" | "default";
}) {
  const colorClass =
    valueColor === "green"
      ? "text-green-500"
      : valueColor === "red"
        ? "text-red-500"
        : "";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className={`font-mono font-semibold text-lg ${colorClass}`}>
          {value}
        </p>
        <p className="text-muted-foreground text-xs">{label}</p>
        {subvalue && (
          <p className="text-[10px] text-muted-foreground/70">{subvalue}</p>
        )}
      </div>
    </div>
  );
}

function TradeHighlight({
  label,
  trade,
  isPositive,
}: {
  label: string;
  trade: { symbol: string; side: string; pnl: number } | null;
  isPositive: boolean;
}) {
  if (!trade) {
    return (
      <div className="flex items-center justify-between rounded border border-border/50 bg-muted/20 p-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className="text-muted-foreground text-xs">—</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded border border-border/50 bg-muted/20 p-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <Badge className="text-[10px]" variant="outline">
          {trade.symbol}
        </Badge>
        <Badge
          className="text-[10px]"
          variant={trade.side === "long" ? "default" : "destructive"}
        >
          {trade.side.toUpperCase()}
        </Badge>
      </div>
      <div
        className={`flex items-center gap-1 font-mono text-sm ${
          isPositive ? "text-green-500" : "text-red-500"
        }`}
      >
        {isPositive ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
        {trade.pnl.toFixed(2)}%
      </div>
    </div>
  );
}

export function PerformanceStatsCard({
  stats,
  isLoading,
}: PerformanceStatsCardProps) {
  if (isLoading) {
    return (
      <TerminalPanel title="Performance">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton className="h-20" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  if (!stats || stats.totalClosed === 0) {
    return (
      <TerminalPanel subtitle="No closed trades" title="Performance">
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Target className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No closed signals yet</p>
          <p className="text-xs">
            Close executed signals to start tracking performance
          </p>
        </div>
      </TerminalPanel>
    );
  }

  const formatHoldingPeriod = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
    return `${(minutes / 1440).toFixed(1)}d`;
  };

  return (
    <TerminalPanel
      subtitle={`${stats.totalClosed} closed trades`}
      title="Performance"
    >
      <div className="space-y-4 p-3">
        {/* Main Stats Grid */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatBox
            icon={Target}
            label="Win Rate"
            subvalue={`${stats.winCount}W / ${stats.lossCount}L`}
            value={`${(stats.winRate * 100).toFixed(1)}%`}
            valueColor={stats.winRate >= 0.5 ? "green" : "red"}
          />
          <StatBox
            icon={TrendingUp}
            label="Total Return"
            value={`${stats.totalReturn >= 0 ? "+" : ""}${stats.totalReturn.toFixed(2)}%`}
            valueColor={stats.totalReturn >= 0 ? "green" : "red"}
          />
          <StatBox
            icon={Award}
            label="Avg Return"
            value={`${stats.avgReturn >= 0 ? "+" : ""}${stats.avgReturn.toFixed(2)}%`}
            valueColor={stats.avgReturn >= 0 ? "green" : "red"}
          />
          <StatBox
            icon={Clock}
            label="Avg Hold Time"
            value={formatHoldingPeriod(stats.avgHoldingPeriodMinutes)}
          />
        </div>

        {/* Sharpe Ratio */}
        {stats.sharpeRatio !== null && (
          <div className="flex items-center justify-between rounded border border-border/50 bg-muted/20 p-2">
            <span className="text-muted-foreground text-xs">
              Sharpe Ratio (annualized)
            </span>
            <span
              className={`font-mono text-sm ${
                stats.sharpeRatio >= 1
                  ? "text-green-500"
                  : stats.sharpeRatio >= 0
                    ? "text-yellow-500"
                    : "text-red-500"
              }`}
            >
              {stats.sharpeRatio.toFixed(2)}
            </span>
          </div>
        )}

        {/* Best/Worst Trades */}
        <div className="space-y-2">
          <TradeHighlight
            isPositive={true}
            label="Best Trade"
            trade={stats.bestTrade}
          />
          <TradeHighlight
            isPositive={false}
            label="Worst Trade"
            trade={stats.worstTrade}
          />
        </div>
      </div>
    </TerminalPanel>
  );
}
