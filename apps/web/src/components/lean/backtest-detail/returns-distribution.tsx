"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculateDailyReturns } from "@/lib/backtest-utils";

interface ReturnsDistributionProps {
  equity: Array<{ date: number; value: number }>;
  bins?: number;
}

export function ReturnsDistribution({
  equity,
  bins = 20,
}: ReturnsDistributionProps) {
  const { histogramData, stats } = useMemo(() => {
    const returns = calculateDailyReturns(equity);
    if (returns.length === 0) {
      return { histogramData: [], stats: null };
    }

    const min = Math.min(...returns);
    const max = Math.max(...returns);
    const binWidth = (max - min) / bins;

    const histogram = Array.from({ length: bins }, (_, i) => ({
      binStart: min + i * binWidth,
      binEnd: min + (i + 1) * binWidth,
      count: 0,
      label: `${(min + i * binWidth).toFixed(1)}%`,
    }));

    for (const ret of returns) {
      const binIndex = Math.min(Math.floor((ret - min) / binWidth), bins - 1);
      histogram[binIndex]!.count++;
    }

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    const positive = returns.filter((r) => r > 0).length;
    const negative = returns.filter((r) => r < 0).length;

    return {
      histogramData: histogram,
      stats: {
        mean,
        std,
        positive,
        negative,
        total: returns.length,
      },
    };
  }, [equity, bins]);

  if (!(histogramData.length && stats)) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Not enough data for distribution
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Mean: </span>
          <span
            className={`font-medium font-mono ${stats.mean >= 0 ? "text-green-500" : "text-red-500"}`}
          >
            {stats.mean.toFixed(3)}%
          </span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Std Dev: </span>
          <span className="font-medium font-mono">{stats.std.toFixed(3)}%</span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Positive Days: </span>
          <span className="font-medium font-mono text-green-500">
            {stats.positive} (
            {((stats.positive / stats.total) * 100).toFixed(1)}%)
          </span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Negative Days: </span>
          <span className="font-medium font-mono text-red-500">
            {stats.negative} (
            {((stats.negative / stats.total) * 100).toFixed(1)}%)
          </span>
        </div>
      </div>

      <ResponsiveContainer height={300} width="100%">
        <BarChart data={histogramData}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="label"
            fontSize={10}
            interval={2}
            tick={{ fill: "#888" }}
          />
          <YAxis
            fontSize={12}
            label={{
              value: "Frequency",
              angle: -90,
              position: "insideLeft",
              fill: "#888",
            }}
            tick={{ fill: "#888" }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="rounded border bg-background p-2 shadow-lg">
                    <p className="text-sm">
                      Range: {d.binStart.toFixed(2)}% to {d.binEnd.toFixed(2)}%
                    </p>
                    <p className="font-bold">{d.count} days</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Bar dataKey="count" radius={[2, 2, 0, 0]}>
            {histogramData.map((entry, index) => (
              <Cell
                fill={entry.binStart >= 0 ? "#22c55e" : "#ef4444"}
                key={`cell-${index}`}
                opacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
