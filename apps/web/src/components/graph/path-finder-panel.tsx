"use client";

import { ArrowRight, Route, Search, X } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useFindPath } from "@/hooks/use-graph";
import type { GraphNode, GraphPath } from "./types";
import { NODE_COLORS } from "./types";

interface PathFinderPanelProps {
  nodes: GraphNode[];
  selectedFromId?: string | null;
  selectedToId?: string | null;
  onPathFound?: (path: GraphPath) => void;
  onClose?: () => void;
}

export function PathFinderPanel({
  nodes,
  selectedFromId,
  selectedToId,
  onPathFound,
  onClose,
}: PathFinderPanelProps) {
  const [fromId, setFromId] = useState<string | null>(selectedFromId || null);
  const [toId, setToId] = useState<string | null>(selectedToId || null);
  const [searchFrom, setSearchFrom] = useState("");
  const [searchTo, setSearchTo] = useState("");
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);

  const { path, loading, error } = useFindPath(fromId, toId);

  // Filter nodes for search
  const filteredFromNodes = nodes.filter((n) =>
    n.name.toLowerCase().includes(searchFrom.toLowerCase())
  );
  const filteredToNodes = nodes.filter((n) =>
    n.name.toLowerCase().includes(searchTo.toLowerCase())
  );

  const fromNode = fromId ? nodes.find((n) => n.id === fromId) : null;
  const toNode = toId ? nodes.find((n) => n.id === toId) : null;

  const handleFromSelect = useCallback((node: GraphNode) => {
    setFromId(node.id);
    setSearchFrom(node.name);
    setShowFromDropdown(false);
  }, []);

  const handleToSelect = useCallback((node: GraphNode) => {
    setToId(node.id);
    setSearchTo(node.name);
    setShowToDropdown(false);
  }, []);

  const handleSwap = useCallback(() => {
    const tempId = fromId;
    const tempSearch = searchFrom;
    setFromId(toId);
    setToId(tempId);
    setSearchFrom(searchTo);
    setSearchTo(tempSearch);
  }, [fromId, toId, searchFrom, searchTo]);

  // Notify parent when path is found
  if (path && onPathFound) {
    onPathFound(path);
  }

  return (
    <div className="flex h-full flex-col border-zinc-800 border-l bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b p-4">
        <div className="flex items-center gap-2">
          <Route className="h-5 w-5 text-amber-500" />
          <h2 className="font-semibold text-lg text-zinc-100">Path Finder</h2>
        </div>
        <Button
          className="h-8 w-8 text-zinc-500 hover:text-zinc-100"
          onClick={onClose}
          size="icon"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4 p-4">
        {/* From selector */}
        <div className="relative">
          <label className="mb-1 block font-mono text-xs text-zinc-500">
            FROM
          </label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              className="border-zinc-700 bg-zinc-800 pl-8 font-mono text-sm"
              onChange={(e) => {
                setSearchFrom(e.target.value);
                setShowFromDropdown(true);
                if (!e.target.value) setFromId(null);
              }}
              onFocus={() => setShowFromDropdown(true)}
              placeholder="Search entity..."
              value={searchFrom}
            />
          </div>
          {showFromDropdown && searchFrom && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
              {filteredFromNodes.slice(0, 10).map((node) => (
                <div
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-zinc-800"
                  key={node.id}
                  onClick={() => handleFromSelect(node)}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[node.type] }}
                  />
                  <span className="text-sm text-zinc-300">{node.name}</span>
                  <Badge
                    className="ml-auto text-xs text-zinc-500"
                    variant="outline"
                  >
                    {node.type}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Swap button */}
        <div className="flex justify-center">
          <Button
            className="text-zinc-500 hover:text-zinc-100"
            onClick={handleSwap}
            size="sm"
            variant="ghost"
          >
            <ArrowRight className="h-4 w-4 rotate-90" />
          </Button>
        </div>

        {/* To selector */}
        <div className="relative">
          <label className="mb-1 block font-mono text-xs text-zinc-500">
            TO
          </label>
          <div className="relative">
            <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              className="border-zinc-700 bg-zinc-800 pl-8 font-mono text-sm"
              onChange={(e) => {
                setSearchTo(e.target.value);
                setShowToDropdown(true);
                if (!e.target.value) setToId(null);
              }}
              onFocus={() => setShowToDropdown(true)}
              placeholder="Search entity..."
              value={searchTo}
            />
          </div>
          {showToDropdown && searchTo && (
            <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
              {filteredToNodes.slice(0, 10).map((node) => (
                <div
                  className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-zinc-800"
                  key={node.id}
                  onClick={() => handleToSelect(node)}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: NODE_COLORS[node.type] }}
                  />
                  <span className="text-sm text-zinc-300">{node.name}</span>
                  <Badge
                    className="ml-auto text-xs text-zinc-500"
                    variant="outline"
                  >
                    {node.type}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1 border-zinc-800 border-t">
        <div className="p-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          ) : path ? (
            <div className="space-y-4">
              {/* Path summary */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-amber-500 text-xs">
                    PATH FOUND
                  </span>
                  <Badge
                    className="border-amber-500/30 text-amber-400"
                    variant="outline"
                  >
                    {path.depth} hops
                  </Badge>
                </div>
                <div className="mt-1 font-mono text-sm text-zinc-300">
                  Weight: {path.totalWeight.toFixed(2)}
                </div>
              </div>

              {/* Path visualization */}
              <div className="space-y-2">
                {path.nodes.map((node, i) => (
                  <div key={node.id}>
                    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/50 p-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: NODE_COLORS[node.type] }}
                      />
                      <span className="font-medium text-sm text-zinc-200">
                        {node.name}
                      </span>
                      <Badge
                        className="ml-auto text-xs text-zinc-500"
                        variant="outline"
                      >
                        {node.type}
                      </Badge>
                    </div>
                    {i < path.nodes.length - 1 && path.edges[i] && (
                      <div className="ml-4 flex items-center gap-2 py-1 text-xs text-zinc-500">
                        <div className="h-4 w-px bg-zinc-700" />
                        <span className="font-mono">
                          {path.edges[i].type} (
                          {(path.edges[i].weight * 100).toFixed(0)}%)
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : fromId && toId ? (
            <div className="py-8 text-center text-zinc-500">
              <Route className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">No path found between these entities</p>
            </div>
          ) : (
            <div className="py-8 text-center text-zinc-500">
              <Route className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">Select two entities to find a path</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
