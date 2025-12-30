"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PageLayout, StatItem, StatRow } from "@/components/layout";
import {
  BacktestSkeleton,
  DrawdownChart,
  MonthlyReturnsChart,
  ReturnsDistribution,
  RollingMetricsChart,
  StatisticsGrouped,
  TradesTable,
} from "@/components/lean/backtest-detail";
import { EquityChart } from "@/components/lean/equity-chart";
import { TradesChart } from "@/components/lean/trades-chart";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import { useBacktest } from "@/hooks/use-backtest";

export default function BacktestResultPage() {
  const params = useParams();
  const id = params.id as string;

  const { backtest, trades, logs, loading, error, fetchLogs } = useBacktest(id);
  const [showLogs, setShowLogs] = useState(false);

  if (loading) {
    return (
      <PageLayout
        backLink={{ href: "/backtests", label: "Backtests" }}
        title="Loading..."
      >
        <BacktestSkeleton />
      </PageLayout>
    );
  }

  if (error || !backtest) {
    return (
      <PageLayout
        backLink={{ href: "/backtests", label: "Backtests" }}
        title="Error"
      >
        <div className="py-8 text-center">
          <p className="text-muted-foreground text-sm">
            {error || "Backtest not found"}
          </p>
          <Link href="/backtests">
            <Button className="mt-4" size="sm" variant="outline">
              Back to Backtests
            </Button>
          </Link>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <Button
          onClick={() => {
            if (!showLogs) fetchLogs();
            setShowLogs(!showLogs);
          }}
          size="sm"
          variant="outline"
        >
          {showLogs ? "Hide Logs" : "Show Logs"}
        </Button>
      }
      backLink={{ href: "/backtests", label: "Backtests" }}
      subtitle={backtest.date}
      title={backtest.strategyName}
    >
      <div className="space-y-4">
        {/* Key Statistics */}
        <StatRow>
          <StatItem
            change={
              backtest.netProfit
                ? {
                    value: Number.parseFloat(
                      backtest.netProfit.replace(/[^0-9.-]/g, "")
                    ),
                    isPositive: !backtest.netProfit.startsWith("-"),
                  }
                : undefined
            }
            label="Net Profit"
            value={backtest.netProfit || "—"}
          />
          <StatItem
            label="Total Orders"
            value={backtest.statistics["Total Orders"] || "0"}
          />
          <StatItem
            label="Win Rate"
            value={backtest.statistics["Win Rate"] || "0%"}
          />
          <StatItem label="Sharpe Ratio" value={backtest.sharpeRatio || "—"} />
        </StatRow>
        <StatRow>
          <StatItem
            label="Sortino Ratio"
            value={backtest.statistics["Sortino Ratio"] || "0"}
          />
          <StatItem label="Max Drawdown" value={backtest.maxDrawdown || "—"} />
          <StatItem
            label="Annual Return"
            value={backtest.statistics["Compounding Annual Return"] || "0%"}
          />
          <StatItem
            label="Total Fees"
            value={backtest.statistics["Total Fees"] || "$0"}
          />
        </StatRow>

        {/* Charts with Tabs */}
        <TerminalPanel title="Charts">
          <Tabs defaultValue="equity">
            <TabsList className="mb-4 flex-wrap" variant="line">
              <TabsTrigger value="equity">Equity Curve</TabsTrigger>
              <TabsTrigger value="drawdown">Drawdown</TabsTrigger>
              <TabsTrigger value="trades-chart">
                Trades ({trades.length})
              </TabsTrigger>
              <TabsTrigger value="monthly">Monthly Returns</TabsTrigger>
              <TabsTrigger value="distribution">Distribution</TabsTrigger>
              <TabsTrigger value="rolling">Rolling Sharpe</TabsTrigger>
            </TabsList>

            <TabsContent value="equity">
              <EquityChart data={backtest.equity} />
            </TabsContent>

            <TabsContent value="drawdown">
              <DrawdownChart equity={backtest.equity} />
            </TabsContent>

            <TabsContent value="trades-chart">
              <TradesChart trades={trades} />
            </TabsContent>

            <TabsContent value="monthly">
              <MonthlyReturnsChart equity={backtest.equity} />
            </TabsContent>

            <TabsContent value="distribution">
              <ReturnsDistribution equity={backtest.equity} />
            </TabsContent>

            <TabsContent value="rolling">
              <RollingMetricsChart equity={backtest.equity} />
            </TabsContent>
          </Tabs>
        </TerminalPanel>

        {/* Trade History Table */}
        {trades.length > 0 && (
          <TerminalPanel
            subtitle={`${trades.length} trades`}
            title="Trade History"
          >
            <TradesTable trades={trades} />
          </TerminalPanel>
        )}

        {/* Grouped Statistics */}
        <TerminalPanel title="Statistics">
          <StatisticsGrouped statistics={backtest.statistics} />
        </TerminalPanel>

        {/* Logs */}
        {showLogs && (
          <TerminalPanel title="Logs">
            <pre className="max-h-96 overflow-auto bg-muted p-3 font-mono text-xs">
              {logs || "Loading logs..."}
            </pre>
          </TerminalPanel>
        )}
      </div>
    </PageLayout>
  );
}
