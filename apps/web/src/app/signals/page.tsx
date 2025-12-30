"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  RefreshCw,
  X,
} from "lucide-react";
import { useState } from "react";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
import { PerformanceStatsCard } from "@/components/signals/performance-stats";
import { SignalApproveDialog } from "@/components/signals/signal-approve-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type Signal,
  useClosedSignals,
  usePendingSignals,
  usePerformanceStats,
  useRejectSignal,
  useSignalStats,
  useSignals,
} from "@/hooks/use-signals";

function SignalRow({
  signal,
  onApprove,
  onReject,
  showActions = false,
}: {
  signal: Signal;
  onApprove?: (signal: Signal) => void;
  onReject?: (signal: Signal) => void;
  showActions?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <div
          className={`flex h-6 w-6 items-center justify-center rounded ${
            signal.side === "long" ? "bg-green-500/20" : "bg-red-500/20"
          }`}
        >
          {signal.side === "long" ? (
            <ArrowUp className="h-4 w-4 text-green-500" />
          ) : (
            <ArrowDown className="h-4 w-4 text-red-500" />
          )}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium font-mono text-sm">
              {signal.symbol}
            </span>
            <Badge
              className="text-[10px]"
              variant={signal.side === "long" ? "default" : "destructive"}
            >
              {signal.side.toUpperCase()}
            </Badge>
            <Badge className="text-[10px]" variant="outline">
              {signal.source}
            </Badge>
          </div>
          <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
            {signal.metadata?.reasoning || "AI generated signal"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {signal.strength && (
          <div className="flex items-center gap-1">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${signal.strength}%` }}
              />
            </div>
            <span className="font-mono text-muted-foreground text-xs">
              {signal.strength}%
            </span>
          </div>
        )}
        <span className="text-muted-foreground text-xs">
          {new Date(signal.createdAt).toLocaleString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
        {showActions && onApprove && onReject && (
          <div className="flex gap-1">
            <Button
              className="h-7 w-7 p-0"
              onClick={() => onApprove(signal)}
              size="sm"
              variant="outline"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              className="h-7 w-7 p-0"
              onClick={() => onReject(signal)}
              size="sm"
              variant="ghost"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SignalsPage() {
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("pending");

  const { data: pendingSignals, isLoading: loadingPending } =
    usePendingSignals();
  const { data: allSignals, isLoading: loadingAll } = useSignals({ limit: 50 });
  const { data: stats } = useSignalStats();
  const { data: performanceStats, isLoading: loadingPerformance } =
    usePerformanceStats();
  const { data: closedSignals, isLoading: loadingClosed } = useClosedSignals({
    limit: 20,
  });
  const rejectSignal = useRejectSignal();

  const handleApprove = (signal: Signal) => {
    setSelectedSignal(signal);
    setApproveDialogOpen(true);
  };

  const handleReject = async (signal: Signal) => {
    if (confirm("Reject this signal?")) {
      await rejectSignal.mutateAsync({ signalId: signal.id });
    }
  };

  const executedSignals =
    allSignals?.filter((s) => s.status === "executed") || [];
  const rejectedSignals =
    allSignals?.filter((s) => s.status === "rejected") || [];

  return (
    <PageLayout
      subtitle="AI-generated signals from news analysis"
      title="Trading Signals"
    >
      {/* Stats Row */}
      <StatRow>
        <StatItem label="Pending" value={stats?.pending || 0} />
        <StatItem label="Executed" value={stats?.executed || 0} />
        <StatItem
          label="Win Rate"
          value={
            performanceStats?.winRate !== undefined
              ? `${(performanceStats.winRate * 100).toFixed(0)}%`
              : "—"
          }
        />
        <StatItem
          label="Total Return"
          value={
            performanceStats?.totalReturn !== undefined
              ? `${performanceStats.totalReturn >= 0 ? "+" : ""}${performanceStats.totalReturn.toFixed(1)}%`
              : "—"
          }
        />
        <StatItem label="Total" value={stats?.total || 0} />
      </StatRow>

      {/* Signals Tabs */}
      <div className="mt-4">
        <Tabs onValueChange={setActiveTab} value={activeTab}>
          <TabsList>
            <TabsTrigger value="pending">
              Pending ({pendingSignals?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="executed">
              Executed ({executedSignals.length})
            </TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="rejected">
              Rejected ({rejectedSignals.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent className="mt-4" value="pending">
            <TerminalPanel
              subtitle={`${pendingSignals?.length || 0} signals`}
              title="Pending Signals"
            >
              {loadingPending ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                </div>
              ) : pendingSignals?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Activity className="mb-2 h-8 w-8 opacity-50" />
                  <p className="text-sm">No pending signals</p>
                  <p className="text-xs">
                    New signals will appear when generated from news analysis
                  </p>
                </div>
              ) : (
                <div>
                  {pendingSignals?.map((signal) => (
                    <SignalRow
                      key={signal.id}
                      onApprove={handleApprove}
                      onReject={handleReject}
                      showActions
                      signal={signal}
                    />
                  ))}
                </div>
              )}
            </TerminalPanel>
          </TabsContent>

          <TabsContent className="mt-4" value="executed">
            <TerminalPanel
              subtitle={`${executedSignals.length} signals`}
              title="Executed Signals"
            >
              {executedSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Activity className="mb-2 h-8 w-8 opacity-50" />
                  <p className="text-sm">No executed signals yet</p>
                </div>
              ) : (
                <div>
                  {executedSignals.map((signal) => (
                    <SignalRow key={signal.id} signal={signal} />
                  ))}
                </div>
              )}
            </TerminalPanel>
          </TabsContent>

          <TabsContent className="mt-4" value="performance">
            <PerformanceStatsCard
              isLoading={loadingPerformance}
              stats={performanceStats}
            />
            {closedSignals && closedSignals.length > 0 && (
              <div className="mt-4">
                <TerminalPanel
                  subtitle={`${closedSignals.length} trades`}
                  title="Closed Trades"
                >
                  <div>
                    {closedSignals.map((signal) => (
                      <div
                        className="flex items-center justify-between border-border/50 border-b px-3 py-2 last:border-0 hover:bg-muted/30"
                        key={signal.id}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-6 w-6 items-center justify-center rounded ${
                              signal.isWin ? "bg-green-500/20" : "bg-red-500/20"
                            }`}
                          >
                            {signal.isWin ? (
                              <ArrowUp className="h-4 w-4 text-green-500" />
                            ) : (
                              <ArrowDown className="h-4 w-4 text-red-500" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium font-mono text-sm">
                                {signal.symbol}
                              </span>
                              <Badge
                                className="text-[10px]"
                                variant={
                                  signal.side === "long"
                                    ? "default"
                                    : "destructive"
                                }
                              >
                                {signal.side.toUpperCase()}
                              </Badge>
                            </div>
                            <p className="mt-0.5 text-muted-foreground text-xs">
                              Entry: {signal.entryPrice} → Exit:{" "}
                              {signal.exitPrice}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-mono text-sm ${
                              signal.isWin ? "text-green-500" : "text-red-500"
                            }`}
                          >
                            {Number(signal.realizedPnl) >= 0 ? "+" : ""}
                            {Number(signal.realizedPnl).toFixed(2)}%
                          </span>
                          {signal.exitAt && (
                            <span className="text-muted-foreground text-xs">
                              {new Date(signal.exitAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </TerminalPanel>
              </div>
            )}
          </TabsContent>

          <TabsContent className="mt-4" value="rejected">
            <TerminalPanel
              subtitle={`${rejectedSignals.length} signals`}
              title="Rejected Signals"
            >
              {rejectedSignals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                  <Activity className="mb-2 h-8 w-8 opacity-50" />
                  <p className="text-sm">No rejected signals</p>
                </div>
              ) : (
                <div>
                  {rejectedSignals.map((signal) => (
                    <SignalRow key={signal.id} signal={signal} />
                  ))}
                </div>
              )}
            </TerminalPanel>
          </TabsContent>
        </Tabs>
      </div>

      <SignalApproveDialog
        onOpenChange={setApproveDialogOpen}
        open={approveDialogOpen}
        signal={selectedSignal}
      />
    </PageLayout>
  );
}
