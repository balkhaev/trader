"use client";

import {
  Filter,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { NODE_COLORS } from "./types";

interface GraphControlsProps {
  onSearch?: (query: string) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onReset?: () => void;
  onRefresh?: () => void;
  onFullscreen?: () => void;
  isFullscreen?: boolean;
  filters?: {
    types: string[];
    minStrength: number;
    maxNodes: number;
  };
  onFiltersChange?: (filters: {
    types: string[];
    minStrength: number;
    maxNodes: number;
  }) => void;
  loading?: boolean;
}

const NODE_TYPES = [
  { id: "entity", label: "Entities", color: NODE_COLORS.entity },
  { id: "topic", label: "Topics", color: NODE_COLORS.topic },
  { id: "event", label: "Events", color: NODE_COLORS.event },
  { id: "region", label: "Regions", color: NODE_COLORS.region },
];

export function GraphControls({
  onSearch,
  onZoomIn,
  onZoomOut,
  onReset,
  onRefresh,
  onFullscreen,
  isFullscreen,
  filters = {
    types: ["entity", "topic", "event", "region"],
    minStrength: 0.1,
    maxNodes: 100,
  },
  onFiltersChange,
  loading,
}: GraphControlsProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
  };

  const handleTypeToggle = (type: string) => {
    const newTypes = filters.types.includes(type)
      ? filters.types.filter((t) => t !== type)
      : [...filters.types, type];
    onFiltersChange?.({ ...filters, types: newTypes });
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 p-2 backdrop-blur">
      {/* Search */}
      <form className="flex items-center gap-1" onSubmit={handleSearch}>
        <div className="relative">
          <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            className="h-8 w-48 border-zinc-700 bg-zinc-800 pl-8 font-mono text-sm placeholder:text-zinc-600"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            value={searchQuery}
          />
        </div>
      </form>

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <Button
          className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
          onClick={onZoomIn}
          size="icon"
          title="Zoom In"
          variant="ghost"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
          onClick={onZoomOut}
          size="icon"
          title="Zoom Out"
          variant="ghost"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
          onClick={onReset}
          size="icon"
          title="Reset View"
          variant="ghost"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      {/* Filters */}
      <Popover>
        <PopoverTrigger
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Filters"
        >
          <Filter className="h-4 w-4" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 border-zinc-700 bg-zinc-900 p-4"
        >
          <div className="space-y-4">
            <div>
              <h4 className="mb-2 font-medium font-mono text-sm text-zinc-300">
                Node Types
              </h4>
              <div className="space-y-2">
                {NODE_TYPES.map((type) => (
                  <div className="flex items-center gap-2" key={type.id}>
                    <Checkbox
                      checked={filters.types.includes(type.id)}
                      id={type.id}
                      onCheckedChange={() => handleTypeToggle(type.id)}
                    />
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: type.color }}
                    />
                    <Label
                      className="font-mono text-sm text-zinc-300"
                      htmlFor={type.id}
                    >
                      {type.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h4 className="mb-2 font-medium font-mono text-sm text-zinc-300">
                Min Connection Strength: {filters.minStrength.toFixed(2)}
              </h4>
              <Slider
                className="w-full"
                max={1}
                min={0}
                onValueChange={([value]) =>
                  onFiltersChange?.({ ...filters, minStrength: value })
                }
                step={0.05}
                value={[filters.minStrength]}
              />
            </div>

            <div>
              <h4 className="mb-2 font-medium font-mono text-sm text-zinc-300">
                Max Nodes: {filters.maxNodes}
              </h4>
              <Slider
                className="w-full"
                max={500}
                min={10}
                onValueChange={([value]) =>
                  onFiltersChange?.({ ...filters, maxNodes: value })
                }
                step={10}
                value={[filters.maxNodes]}
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <div className="mx-1 h-6 w-px bg-zinc-700" />

      {/* Actions */}
      <Button
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
        disabled={loading}
        onClick={onRefresh}
        size="icon"
        title="Refresh"
        variant="ghost"
      >
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      </Button>

      <Button
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
        onClick={onFullscreen}
        size="icon"
        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        variant="ghost"
      >
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </Button>

      {/* Legend */}
      <div className="mx-1 h-6 w-px bg-zinc-700" />
      <div className="flex items-center gap-3">
        {NODE_TYPES.map((type) => (
          <div
            className="flex items-center gap-1 text-xs text-zinc-500"
            key={type.id}
          >
            <div
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: type.color }}
            />
            <span>{type.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
