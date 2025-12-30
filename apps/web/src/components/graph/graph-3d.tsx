"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GraphNode } from "./types";
import { EDGE_COLORS, NODE_COLORS, NODE_COLORS_BRIGHT } from "./types";

// Dynamic import to avoid SSR issues with Three.js
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-black">
      <div className="text-zinc-500">Loading 3D Graph...</div>
    </div>
  ),
});

interface Graph3DProps {
  graph: Graph;
  onNodeClick?: (node: GraphNode) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  onNodeHover?: (node: GraphNode | null) => void;
  selectedNodeId?: string | null;
  highlightedPath?: string[];
  width?: number;
  height?: number;
  showLabels?: boolean;
  linkOpacity?: number;
}

export function Graph3D({
  graph,
  onNodeClick,
  onNodeDoubleClick,
  onNodeHover,
  selectedNodeId,
  highlightedPath,
  width,
  height,
  showLabels = true,
  linkOpacity = 0.3,
}: Graph3DProps) {
  const fgRef = useRef<{
    centerAt?: (x: number, y: number, z: number, ms: number) => void;
  }>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: width || rect.width,
          height: height || rect.height,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [width, height]);

  // Prepare graph data with proper format
  const graphData = useMemo(() => {
    const highlightSet = new Set(highlightedPath || []);

    return {
      nodes: graph.nodes.map((node) => ({
        ...node,
        highlighted: highlightSet.has(node.id) || node.id === selectedNodeId,
        selected: node.id === selectedNodeId,
      })),
      links: graph.edges.map((edge) => ({
        source: typeof edge.source === "string" ? edge.source : edge.source.id,
        target: typeof edge.target === "string" ? edge.target : edge.target.id,
        type: edge.type,
        weight: edge.weight,
        coOccurrences: edge.coOccurrences,
        highlighted:
          highlightSet.has(
            typeof edge.source === "string" ? edge.source : edge.source.id
          ) &&
          highlightSet.has(
            typeof edge.target === "string" ? edge.target : edge.target.id
          ),
      })),
    };
  }, [graph, selectedNodeId, highlightedPath]);

  // Node color based on type and state
  const getNodeColor = useCallback(
    (node: GraphNode & { highlighted?: boolean; selected?: boolean }) => {
      if (node.selected) return "#ffffff";
      if (node.highlighted) return NODE_COLORS_BRIGHT[node.type] || "#60a5fa";
      if (hoveredNode?.id === node.id)
        return NODE_COLORS_BRIGHT[node.type] || "#60a5fa";
      return NODE_COLORS[node.type] || "#64748b";
    },
    [hoveredNode]
  );

  // Node size based on mentions/importance
  const getNodeSize = useCallback((node: GraphNode) => {
    const baseSize = 4;
    const mentionFactor = Math.log2(Math.max(1, node.size || 1)) * 2;
    return Math.min(20, baseSize + mentionFactor);
  }, []);

  // Link color based on type
  const getLinkColor = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (link: any) => {
      if (link.highlighted) return "#f59e0b";
      return EDGE_COLORS[link.type || "co_occurrence"] || "#475569";
    },
    []
  );

  // Link width based on weight
  const getLinkWidth = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (link: any) => {
      if (link.highlighted) return 3;
      return Math.max(0.5, (link.weight || 0.1) * 3);
    },
    []
  );

  // Handle node click
  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  // Handle double click for drill-down
  const handleNodeDoubleClick = useCallback(
    (node: GraphNode) => {
      onNodeDoubleClick?.(node);
    },
    [onNodeDoubleClick]
  );

  // Handle hover
  const handleNodeHover = useCallback(
    (node: GraphNode | null) => {
      setHoveredNode(node);
      onNodeHover?.(node);
    },
    [onNodeHover]
  );

  // Custom node label
  const getNodeLabel = useCallback((node: GraphNode) => {
    return `${node.name}\nType: ${node.type}${node.subtype ? ` (${node.subtype})` : ""}\nMentions: ${node.metadata?.totalMentions || node.size || 0}`;
  }, []);

  return (
    <div className="relative h-full w-full bg-black" ref={containerRef}>
      <ForceGraph3D
        backgroundColor="#0a0a0a"
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        graphData={graphData}
        // Node styling
        height={dimensions.height}
        linkColor={getLinkColor}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticles={2}
        linkDirectionalParticleWidth={1}
        // Link styling
        linkOpacity={linkOpacity}
        linkWidth={getLinkWidth}
        nodeColor={getNodeColor}
        nodeLabel={getNodeLabel}
        nodeOpacity={0.9}
        nodeResolution={16}
        // Interactions
        nodeThreeObject={
          showLabels
            ? (node: GraphNode) => {
                // Create sprite for label
                const sprite = new // @ts-expect-error - Three.js types
                (window.THREE || require("three")).Sprite(
                  new // @ts-expect-error - Three.js types
                  (window.THREE || require("three")).SpriteMaterial({
                    map: createTextTexture(node.name),
                    transparent: true,
                  })
                );
                sprite.scale.set(20, 10, 1);
                sprite.position.set(0, getNodeSize(node) + 5, 0);
                return sprite;
              }
            : undefined
        }
        nodeThreeObjectExtend={showLabels}
        nodeVal={getNodeSize}
        // Physics
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onNodeRightClick={handleNodeDoubleClick}
        ref={fgRef}
        // Labels (using sprites)
        warmupTicks={100}
        width={dimensions.width}
      />

      {/* Hover tooltip */}
      {hoveredNode && (
        <div className="pointer-events-none absolute top-4 left-4 max-w-xs rounded-lg border border-zinc-700 bg-zinc-900/95 p-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: NODE_COLORS[hoveredNode.type] }}
            />
            <span className="font-semibold text-zinc-100">
              {hoveredNode.name}
            </span>
          </div>
          <div className="mt-2 space-y-1 font-mono text-xs text-zinc-400">
            <div>
              Type: {hoveredNode.type}
              {hoveredNode.subtype ? ` / ${hoveredNode.subtype}` : ""}
            </div>
            <div>
              Mentions:{" "}
              {hoveredNode.metadata?.totalMentions || hoveredNode.size}
            </div>
            <div>
              Sentiment:{" "}
              <span
                className={
                  hoveredNode.sentiment > 0.2
                    ? "text-emerald-400"
                    : hoveredNode.sentiment < -0.2
                      ? "text-red-400"
                      : "text-zinc-400"
                }
              >
                {hoveredNode.sentiment.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            Click to select • Right-click to explore
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to create text texture for labels
function createTextTexture(text: string): THREE.Texture | null {
  if (typeof window === "undefined") return null;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return null;

  canvas.width = 256;
  canvas.height = 64;

  context.fillStyle = "transparent";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.font = "24px JetBrains Mono, monospace";
  context.fillStyle = "#e4e4e7";
  context.textAlign = "center";
  context.textBaseline = "middle";

  // Truncate long text
  const maxLength = 20;
  const displayText =
    text.length > maxLength ? text.slice(0, maxLength) + "..." : text;
  context.fillText(displayText, canvas.width / 2, canvas.height / 2);

  // @ts-expect-error - Three.js types
  const THREE = window.THREE || require("three");
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Required for Three.js type
declare global {
  interface Window {
    THREE?: typeof import("three");
  }
}
