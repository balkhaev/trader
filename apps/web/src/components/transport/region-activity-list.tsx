"use client";

import { ArrowDown, ArrowUp, Globe, Minus, Plane, Ship } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { RegionActivity } from "@/hooks/use-transport";

interface RegionActivityListProps {
  regions?: RegionActivity[];
  isLoading?: boolean;
}

const COMMODITY_LABELS: Record<string, string> = {
  crude_oil: "Oil",
  brent: "Brent",
  natural_gas: "Gas",
  lng: "LNG",
  lpg: "LPG",
  wheat: "Wheat",
  corn: "Corn",
  soybeans: "Soy",
  rice: "Rice",
  copper: "Cu",
  aluminum: "Al",
  iron_ore: "Fe",
  coal: "Coal",
  container_freight: "Container",
};

function RegionRow({ region }: { region: RegionActivity }) {
  const commodityLabel = region.dominantCommodity
    ? COMMODITY_LABELS[region.dominantCommodity] || region.dominantCommodity
    : null;

  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2.5 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <Globe className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <span className="font-medium text-sm">{region.region}</span>
          {commodityLabel && (
            <Badge className="ml-2 text-[10px]" variant="secondary">
              {commodityLabel}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1 text-muted-foreground">
          <Ship className="h-3.5 w-3.5" />
          <span className="font-mono text-sm">{region.vesselCount}</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Plane className="h-3.5 w-3.5" />
          <span className="font-mono text-sm">{region.aircraftCount}</span>
        </div>
        {region.changePercent !== 0 && (
          <div
            className={`flex items-center gap-0.5 text-sm ${
              region.changePercent > 0
                ? "text-green-500"
                : region.changePercent < 0
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {region.changePercent > 0 ? (
              <ArrowUp className="h-3 w-3" />
            ) : region.changePercent < 0 ? (
              <ArrowDown className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            <span className="font-mono">
              {Math.abs(region.changePercent).toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function RegionActivityList({
  regions,
  isLoading,
}: RegionActivityListProps) {
  if (isLoading) {
    return (
      <TerminalPanel title="Region Activity">
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton className="h-12" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  if (!regions || regions.length === 0) {
    return (
      <TerminalPanel title="Region Activity">
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Globe className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No region data</p>
          <p className="text-xs">
            Region activity is calculated from positions
          </p>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel subtitle="Last 24 hours" title="Region Activity">
      <div>
        {regions.map((region) => (
          <RegionRow key={region.region} region={region} />
        ))}
      </div>
    </TerminalPanel>
  );
}
