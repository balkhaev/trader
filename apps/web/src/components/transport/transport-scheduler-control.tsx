"use client";

import { Play, RefreshCw, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useAnalyzeTransportData,
  useCollectTransportData,
  useStartTransportScheduler,
  useStopTransportScheduler,
  useTransportSchedulerStatus,
} from "@/hooks/use-transport";

export function TransportSchedulerControl() {
  const { data: status, isLoading } = useTransportSchedulerStatus();
  const collect = useCollectTransportData();
  const analyze = useAnalyzeTransportData();
  const startScheduler = useStartTransportScheduler();
  const stopScheduler = useStopTransportScheduler();

  const handleToggleScheduler = () => {
    if (status?.isRunning) {
      stopScheduler.mutate(undefined, {
        onSuccess: () => toast.info("Scheduler stopped"),
        onError: () => toast.error("Failed to stop scheduler"),
      });
    } else {
      startScheduler.mutate(undefined, {
        onSuccess: () => toast.success("Scheduler started"),
        onError: () => toast.error("Failed to start scheduler"),
      });
    }
  };

  const handleCollect = () => {
    collect.mutate("all", {
      onSuccess: (data) =>
        toast.success(
          `Collected ${data.result?.vesselsCollected || 0} vessels, ${data.result?.aircraftCollected || 0} aircraft`
        ),
      onError: () => toast.error("Failed to collect data"),
    });
  };

  const handleAnalyze = () => {
    analyze.mutate(undefined, {
      onSuccess: (data) =>
        toast.success(
          `Analyzed ${data.flowsAnalyzed || 0} flows, generated ${data.signalsGenerated || 0} signals`
        ),
      onError: () => toast.error("Failed to analyze data"),
    });
  };

  const formatTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleTimeString();
  };

  return (
    <TerminalPanel
      subtitle={status?.isRunning ? "Running" : "Stopped"}
      title="Scheduler"
    >
      <div className="space-y-3 p-3">
        {/* Status info */}
        <div className="grid gap-2 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last vessels:</span>
            <span className="font-mono">
              {formatTime(status?.lastVesselCollection)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last aircraft:</span>
            <span className="font-mono">
              {formatTime(status?.lastAircraftCollection)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last analysis:</span>
            <span className="font-mono">
              {formatTime(status?.lastAnalysis)}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={
              isLoading || startScheduler.isPending || stopScheduler.isPending
            }
            onClick={handleToggleScheduler}
            size="sm"
            variant={status?.isRunning ? "destructive" : "default"}
          >
            {status?.isRunning ? (
              <>
                <Square className="mr-1 h-3 w-3" />
                Stop
              </>
            ) : (
              <>
                <Play className="mr-1 h-3 w-3" />
                Start
              </>
            )}
          </Button>
          <Button
            disabled={collect.isPending}
            onClick={handleCollect}
            size="sm"
            variant="outline"
          >
            {collect.isPending ? (
              <RefreshCw className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
          <Button
            disabled={analyze.isPending}
            onClick={handleAnalyze}
            size="sm"
            variant="outline"
          >
            Analyze
          </Button>
        </div>
      </div>
    </TerminalPanel>
  );
}
