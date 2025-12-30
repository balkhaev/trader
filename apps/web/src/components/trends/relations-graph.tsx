"use client";

import { GitBranch, RefreshCw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useGraph } from "@/hooks/use-trends";

// Простая визуализация графа с помощью canvas
function drawGraph(
  canvas: HTMLCanvasElement,
  nodes: Array<{
    id: string;
    name: string;
    type: string;
    size: number;
    x?: number;
    y?: number;
  }>,
  edges: Array<{ source: string; target: string; weight: number }>
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  // Позиционируем узлы по кругу если нет позиций
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) / 2 - 80;

  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    node.x = centerX + radius * Math.cos(angle);
    node.y = centerY + radius * Math.sin(angle);
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Рисуем рёбра
  ctx.strokeStyle = "rgba(100, 116, 139, 0.3)";
  edges.forEach((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (source?.x && source?.y && target?.x && target?.y) {
      ctx.beginPath();
      ctx.lineWidth = Math.max(1, edge.weight * 3);
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
  });

  // Рисуем узлы
  const typeColors: Record<string, string> = {
    entity: "#3b82f6",
    topic: "#a855f7",
    event: "#f59e0b",
    region: "#10b981",
  };

  nodes.forEach((node) => {
    if (node.x === undefined || node.y === undefined) return;

    const nodeRadius = Math.min(30, Math.max(8, Math.sqrt(node.size) * 2));
    const color = typeColors[node.type] || "#64748b";

    // Круг
    ctx.beginPath();
    ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);
    ctx.fillStyle = color + "40";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Текст
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(node.name, node.x, node.y + nodeRadius + 14);
  });
}

export function RelationsGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const { graph, loading, error, refetch } = useGraph({
    maxNodes: 50,
    minStrength: 0.1,
  });

  useEffect(() => {
    if (canvasRef.current && graph.nodes.length > 0) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(
          window.devicePixelRatio * zoom,
          window.devicePixelRatio * zoom
        );
      }
      drawGraph(canvas, graph.nodes, graph.edges);
    }
  }, [graph, zoom]);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-zinc-100">Relations Graph</CardTitle>
          </div>
          <div className="flex gap-1">
            <Button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              size="icon"
              variant="ghost"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              size="icon"
              variant="ghost"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button onClick={refetch} size="icon" variant="ghost">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="text-zinc-500">
          {graph.nodes.length} nodes, {graph.edges.length} connections
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-96 items-center justify-center text-zinc-500">
            Loading graph...
          </div>
        ) : error ? (
          <div className="flex h-96 items-center justify-center text-red-400">
            Failed to load graph
          </div>
        ) : graph.nodes.length === 0 ? (
          <div className="flex h-96 items-center justify-center text-zinc-500">
            No graph data available
          </div>
        ) : (
          <canvas
            className="h-96 w-full rounded-lg bg-zinc-950"
            ref={canvasRef}
            style={{ imageRendering: "crisp-edges" }}
          />
        )}
      </CardContent>
    </Card>
  );
}
