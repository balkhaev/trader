"use client";

import { Anchor, Plane, Radio, Ship } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { TransportStats } from "@/hooks/use-transport";

interface TransportOverviewCardProps {
  data?: TransportStats;
  isLoading?: boolean;
}

function StatBox({
  icon: Icon,
  label,
  value,
  subvalue,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  subvalue?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="font-mono font-semibold text-lg">{value}</p>
        <p className="text-muted-foreground text-xs">{label}</p>
        {subvalue && (
          <p className="text-[10px] text-muted-foreground/70">{subvalue}</p>
        )}
      </div>
    </div>
  );
}

export function TransportOverviewCard({
  data,
  isLoading,
}: TransportOverviewCardProps) {
  if (isLoading) {
    return (
      <TerminalPanel title="Transport Overview">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton className="h-20" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);
    if (diff < 1) return "Just now";
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <TerminalPanel
      subtitle="Real-time vessel and aircraft tracking"
      title="Transport Overview"
    >
      <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox
          icon={Ship}
          label="Active Vessels"
          subvalue={`Updated ${formatTime(data?.lastVesselCollection ?? null)}`}
          value={data?.totalVessels ?? 0}
        />
        <StatBox
          icon={Plane}
          label="Active Aircraft"
          subvalue={`Updated ${formatTime(data?.lastAircraftCollection ?? null)}`}
          value={data?.totalAircraft ?? 0}
        />
        <StatBox
          icon={Anchor}
          label="Positions Tracked"
          value={data?.totalPositions ?? 0}
        />
        <StatBox
          icon={Radio}
          label="Active Signals"
          value={data?.totalSignals ?? 0}
        />
      </div>
    </TerminalPanel>
  );
}
