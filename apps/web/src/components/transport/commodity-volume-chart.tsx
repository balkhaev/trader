"use client";

import { ArrowDown, ArrowUp, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { CommodityVolume } from "@/hooks/use-transport";

interface CommodityVolumeChartProps {
  volumes?: CommodityVolume[];
  isLoading?: boolean;
}

const COMMODITY_COLORS: Record<string, string> = {
  crude_oil: "bg-amber-500",
  brent: "bg-orange-500",
  natural_gas: "bg-blue-400",
  lng: "bg-cyan-500",
  lpg: "bg-teal-500",
  wheat: "bg-yellow-500",
  corn: "bg-lime-500",
  soybeans: "bg-green-500",
  rice: "bg-emerald-500",
  copper: "bg-orange-600",
  aluminum: "bg-slate-400",
  iron_ore: "bg-red-700",
  coal: "bg-stone-600",
  container_freight: "bg-indigo-500",
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

function VolumeBar({
  volume,
  maxVolume,
}: {
  volume: CommodityVolume;
  maxVolume: number;
}) {
  const percentage = maxVolume > 0 ? (volume.totalVolume / maxVolume) * 100 : 0;
  const colorClass = COMMODITY_COLORS[volume.commodity] || "bg-primary";
  const label = COMMODITY_LABELS[volume.commodity] || volume.commodity;

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-24 text-sm">{label}</div>
      <div className="flex-1">
        <div className="h-6 w-full overflow-hidden rounded bg-muted/50">
          <div
            className={`h-full ${colorClass} transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
      <div className="flex w-24 items-center justify-end gap-2">
        <span className="font-mono text-sm">{volume.vesselCount} ships</span>
        {volume.changePercent !== 0 && (
          <Badge
            className="text-[10px]"
            variant={volume.changePercent > 0 ? "default" : "destructive"}
          >
            {volume.changePercent > 0 ? (
              <ArrowUp className="mr-0.5 h-3 w-3" />
            ) : (
              <ArrowDown className="mr-0.5 h-3 w-3" />
            )}
            {Math.abs(volume.changePercent).toFixed(1)}%
          </Badge>
        )}
      </div>
    </div>
  );
}

export function CommodityVolumeChart({
  volumes,
  isLoading,
}: CommodityVolumeChartProps) {
  if (isLoading) {
    return (
      <TerminalPanel title="Commodity Volumes">
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton className="h-8" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  if (!(volumes && Array.isArray(volumes)) || volumes.length === 0) {
    return (
      <TerminalPanel title="Commodity Volumes">
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Package className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No volume data</p>
          <p className="text-xs">
            Volume data is collected from vessel tracking
          </p>
        </div>
      </TerminalPanel>
    );
  }

  const maxVolume = Math.max(...volumes.map((v) => v.totalVolume));

  return (
    <TerminalPanel subtitle="Last 7 days" title="Commodity Volumes">
      <div className="p-3">
        {volumes.map((volume) => (
          <VolumeBar
            key={volume.commodity}
            maxVolume={maxVolume}
            volume={volume}
          />
        ))}
      </div>
    </TerminalPanel>
  );
}
