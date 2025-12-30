"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { calculateDrawdown } from "@/lib/backtest-utils";

interface DrawdownChartProps {
  equity: Array<{ date: number; value: number }>;
}

export function DrawdownChart({ equity }: DrawdownChartProps) {
  const drawdownData = useMemo(() => {
    return calculateDrawdown(equity).map((d) => ({
      ...d,
      dateStr: new Date(d.date).toLocaleDateString(),
      drawdownNegative: -d.drawdown,
    }));
  }, [equity]);

  const maxDrawdown = Math.min(...drawdownData.map((d) => d.drawdownNegative));

  if (!drawdownData.length) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No drawdown data available
      </div>
    );
  }

  return (
    <ResponsiveContainer height={350} width="100%">
      <AreaChart data={drawdownData}>
        <defs>
          <linearGradient id="drawdownGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
        <XAxis
          dataKey="dateStr"
          fontSize={12}
          interval="preserveStartEnd"
          tick={{ fill: "#888" }}
          tickLine={false}
        />
        <YAxis
          domain={[maxDrawdown * 1.1, 0]}
          fontSize={12}
          tick={{ fill: "#888" }}
          tickFormatter={(v: number) => `${v.toFixed(1)}%`}
          tickLine={false}
          width={60}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const d = payload[0]?.payload;
              if (!d) return null;
              return (
                <div className="rounded border bg-background p-2 shadow-lg">
                  <p className="text-sm">{d.dateStr}</p>
                  <p className="font-bold text-red-500">
                    Drawdown: {d.drawdown.toFixed(2)}%
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Peak: ${d.peak.toFixed(2)}
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <ReferenceLine stroke="#888" strokeDasharray="3 3" y={0} />
        <Area
          dataKey="drawdownNegative"
          fill="url(#drawdownGradient)"
          stroke="#ef4444"
          strokeWidth={2}
          type="monotone"
        />
        <Brush dataKey="dateStr" fill="#f5f5f5" height={30} stroke="#ef4444" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
