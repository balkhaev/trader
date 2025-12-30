"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp } from "lucide-react";

interface HistoryPoint {
  date: string;
  value: number;
  pnl: number;
}

interface PerformanceChartProps {
  slug: string;
  days?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchHistory(
  slug: string,
  days: number
): Promise<{ history: HistoryPoint[] }> {
  const res = await fetch(
    `${API_BASE}/api/agents/${slug}/history?days=${days}`
  );
  if (!res.ok) throw new Error("Failed to fetch history");
  return res.json();
}

export function PerformanceChart({ slug, days = 30 }: PerformanceChartProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["agent", slug, "history", days],
    queryFn: () => fetchHistory(slug, days),
  });

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded-xl bg-zinc-800/50" />;
  }

  const history = data?.history ?? [];

  if (history.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 border-dashed text-zinc-500">
        No performance data yet
      </div>
    );
  }

  // Calculate chart dimensions
  const width = 100;
  const height = 100;
  const padding = 10;

  const values = history.map((h) => h.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;

  // Normalize values to chart coordinates
  const points = history.map((h, i) => {
    const x = padding + (i / (history.length - 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      ((h.value - minValue) / range) * (height - padding * 2);
    return { x, y, ...h };
  });

  // Create SVG path
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  // Create gradient area path
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? 0} ${height - padding} L ${padding} ${height - padding} Z`;

  const lastValue = history[history.length - 1]?.value ?? 100;
  const firstValue = history[0]?.value ?? 100;
  const totalChange = lastValue - firstValue;
  const percentChange = (totalChange / firstValue) * 100;
  const isPositive = totalChange >= 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Performance</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Last {days} days</span>
          <div
            className={`flex items-center gap-1 rounded px-2 py-1 font-medium text-sm ${
              isPositive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {isPositive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {isPositive ? "+" : ""}
            {percentChange.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-40">
        <svg
          className="h-full w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${width} ${height}`}
        >
          {/* Gradient definition */}
          <defs>
            <linearGradient id="chartGradient" x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor={isPositive ? "#10b981" : "#ef4444"}
                stopOpacity="0.3"
              />
              <stop
                offset="100%"
                stopColor={isPositive ? "#10b981" : "#ef4444"}
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              stroke="#27272a"
              strokeWidth="0.5"
              x1={padding}
              x2={width - padding}
              y1={padding + ratio * (height - padding * 2)}
              y2={padding + ratio * (height - padding * 2)}
            />
          ))}

          {/* Area fill */}
          <path d={areaPath} fill="url(#chartGradient)" />

          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={isPositive ? "#10b981" : "#ef4444"}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />

          {/* End point */}
          {points.length > 0 && (
            <circle
              cx={points[points.length - 1]?.x}
              cy={points[points.length - 1]?.y}
              fill={isPositive ? "#10b981" : "#ef4444"}
              r="3"
            />
          )}
        </svg>

        {/* Y-axis labels */}
        <div className="absolute top-0 left-0 flex h-full flex-col justify-between py-2 text-[10px] text-zinc-500">
          <span>{maxValue.toFixed(1)}%</span>
          <span>{((maxValue + minValue) / 2).toFixed(1)}%</span>
          <span>{minValue.toFixed(1)}%</span>
        </div>
      </div>

      {/* X-axis labels */}
      <div className="mt-2 flex justify-between text-[10px] text-zinc-500">
        <span>{history[0]?.date}</span>
        <span>{history[history.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export default PerformanceChart;
