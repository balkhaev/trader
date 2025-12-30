"use client";

import { ArrowDown, ArrowUp, Minus, Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { TransportSignal } from "@/hooks/use-transport";

interface TransportSignalsTableProps {
  signals?: TransportSignal[];
  isLoading?: boolean;
  title?: string;
}

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  tanker_surge: "Tanker Surge",
  tanker_decline: "Tanker Decline",
  bulk_flow_increase: "Bulk Flow Up",
  bulk_flow_drop: "Bulk Flow Down",
  port_congestion: "Port Congestion",
  private_jet_cluster: "Private Jet Cluster",
};

const COMMODITY_LABELS: Record<string, string> = {
  crude_oil: "Crude Oil",
  brent: "Brent",
  natural_gas: "Natural Gas",
  lng: "LNG",
  lpg: "LPG",
  wheat: "Wheat",
  corn: "Corn",
  soybeans: "Soybeans",
  rice: "Rice",
  copper: "Copper",
  aluminum: "Aluminum",
  iron_ore: "Iron Ore",
  coal: "Coal",
  container_freight: "Container",
};

function DirectionIcon({ direction }: { direction: string }) {
  if (direction === "bullish") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded bg-green-500/20">
        <ArrowUp className="h-4 w-4 text-green-500" />
      </div>
    );
  }
  if (direction === "bearish") {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded bg-red-500/20">
        <ArrowDown className="h-4 w-4 text-red-500" />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded bg-yellow-500/20">
      <Minus className="h-4 w-4 text-yellow-500" />
    </div>
  );
}

function SignalRow({ signal }: { signal: TransportSignal }) {
  const strength = Number.parseFloat(signal.strength);
  const confidence = Number.parseFloat(signal.confidence);

  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2.5 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <DirectionIcon direction={signal.direction} />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {SIGNAL_TYPE_LABELS[signal.signalType] || signal.signalType}
            </span>
            {signal.commodity && (
              <Badge className="text-[10px]" variant="secondary">
                {COMMODITY_LABELS[signal.commodity] || signal.commodity}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
            {signal.description}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Strength</span>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${strength * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs">
              {(strength * 100).toFixed(0)}%
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-muted-foreground text-xs">Confidence</span>
            <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
            <span className="font-mono text-xs">
              {(confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
        {signal.affectedTickers && signal.affectedTickers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {signal.affectedTickers.slice(0, 3).map((ticker) => (
              <Badge className="text-[10px]" key={ticker} variant="outline">
                {ticker}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TransportSignalsTable({
  signals,
  isLoading,
  title = "Transport Signals",
}: TransportSignalsTableProps) {
  if (isLoading) {
    return (
      <TerminalPanel title={title}>
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton className="h-16" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  if (!signals || signals.length === 0) {
    return (
      <TerminalPanel subtitle="0 signals" title={title}>
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Radio className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No active signals</p>
          <p className="text-xs">
            Signals are generated from transport flow analysis
          </p>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel subtitle={`${signals.length} active`} title={title}>
      <div>
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
      </div>
    </TerminalPanel>
  );
}
