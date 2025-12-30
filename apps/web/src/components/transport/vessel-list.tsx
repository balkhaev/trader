"use client";

import { Anchor, Ship } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import type { Vessel } from "@/hooks/use-transport";

interface VesselListProps {
  vessels?: Vessel[];
  isLoading?: boolean;
  title?: string;
}

const VESSEL_TYPE_LABELS: Record<string, string> = {
  tanker_crude: "Crude Tanker",
  tanker_product: "Product Tanker",
  tanker_chemical: "Chemical Tanker",
  tanker_lng: "LNG Tanker",
  tanker_lpg: "LPG Tanker",
  bulk_carrier: "Bulk Carrier",
  container: "Container",
  ore_carrier: "Ore Carrier",
  general_cargo: "General Cargo",
  ro_ro: "Ro-Ro",
  passenger: "Passenger",
  fishing: "Fishing",
  tug: "Tug",
  other: "Other",
};

const VESSEL_TYPE_COLORS: Record<string, string> = {
  tanker_crude: "bg-amber-500/20 text-amber-400",
  tanker_product: "bg-orange-500/20 text-orange-400",
  tanker_chemical: "bg-purple-500/20 text-purple-400",
  tanker_lng: "bg-cyan-500/20 text-cyan-400",
  tanker_lpg: "bg-teal-500/20 text-teal-400",
  bulk_carrier: "bg-yellow-500/20 text-yellow-400",
  container: "bg-indigo-500/20 text-indigo-400",
  ore_carrier: "bg-red-500/20 text-red-400",
  general_cargo: "bg-gray-500/20 text-gray-400",
};

function VesselRow({ vessel }: { vessel: Vessel }) {
  const typeLabel = VESSEL_TYPE_LABELS[vessel.vesselType] || vessel.vesselType;
  const typeColor =
    VESSEL_TYPE_COLORS[vessel.vesselType] || "bg-gray-500/20 text-gray-400";

  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-muted">
          <Ship className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">
              {vessel.name || "Unknown"}
            </span>
            <Badge className={`text-[10px] ${typeColor}`} variant="secondary">
              {typeLabel}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-muted-foreground text-xs">
            <span>MMSI: {vessel.mmsi}</span>
            {vessel.flag && <span>Flag: {vessel.flag}</span>}
            {vessel.deadweight && <span>DWT: {vessel.deadweight}</span>}
          </div>
        </div>
      </div>
      <div className="text-right text-muted-foreground text-xs">
        {new Date(vessel.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

export function VesselList({
  vessels,
  isLoading,
  title = "Recent Vessels",
}: VesselListProps) {
  if (isLoading) {
    return (
      <TerminalPanel title={title}>
        <div className="space-y-2 p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton className="h-14" key={i} />
          ))}
        </div>
      </TerminalPanel>
    );
  }

  if (!vessels || vessels.length === 0) {
    return (
      <TerminalPanel title={title}>
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <Anchor className="mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">No vessels tracked</p>
          <p className="text-xs">Start collecting data to see vessels</p>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel subtitle={`${vessels.length} vessels`} title={title}>
      <div>
        {vessels.map((vessel) => (
          <VesselRow key={vessel.id} vessel={vessel} />
        ))}
      </div>
    </TerminalPanel>
  );
}
