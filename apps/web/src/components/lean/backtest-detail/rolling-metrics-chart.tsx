"use client";

import { useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { calculateRollingSharpe } from "@/lib/backtest-utils";

interface RollingMetricsChartProps {
  equity: Array<{ date: number; value: number }>;
}

const WINDOW_OPTIONS = [
  { value: "20", label: "20 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
];

export function RollingMetricsChart({ equity }: RollingMetricsChartProps) {
  const [window, setWindow] = useState(30);

  const rollingData = useMemo(() => {
    return calculateRollingSharpe(equity, window).map((d) => ({
      ...d,
      dateStr: new Date(d.date).toLocaleDateString(),
    }));
  }, [equity, window]);

  if (rollingData.length < 10) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Not enough data for rolling metrics (need at least {window + 10} data
        points)
      </div>
    );
  }

  const avgSharpe =
    rollingData.reduce((sum, d) => sum + d.sharpe, 0) / rollingData.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">Window:</span>
          <Select
            onValueChange={(v) => setWindow(Number(v))}
            value={window.toString()}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Avg Sharpe: </span>
          <span
            className={`font-medium font-mono ${avgSharpe >= 0 ? "text-green-500" : "text-red-500"}`}
          >
            {avgSharpe.toFixed(2)}
          </span>
        </div>
      </div>

      <ResponsiveContainer height={350} width="100%">
        <LineChart data={rollingData}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="dateStr"
            fontSize={12}
            interval="preserveStartEnd"
            tick={{ fill: "#888" }}
            tickLine={false}
          />
          <YAxis
            fontSize={12}
            tick={{ fill: "#888" }}
            tickLine={false}
            width={50}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="rounded border bg-background p-2 shadow-lg">
                    <p className="text-sm">{d.dateStr}</p>
                    <p
                      className={`font-bold ${d.sharpe >= 0 ? "text-green-500" : "text-red-500"}`}
                    >
                      Sharpe: {d.sharpe.toFixed(2)}
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <ReferenceLine
            label={{ value: "0", fill: "#888", fontSize: 10 }}
            stroke="#888"
            strokeDasharray="3 3"
            y={0}
          />
          <ReferenceLine
            label={{ value: "Good (1.0)", fill: "#22c55e", fontSize: 10 }}
            stroke="#22c55e"
            strokeDasharray="5 5"
            y={1}
          />
          <ReferenceLine
            label={{ value: "Excellent (2.0)", fill: "#22c55e", fontSize: 10 }}
            stroke="#22c55e"
            strokeDasharray="5 5"
            y={2}
          />
          <Line
            dataKey="sharpe"
            dot={false}
            stroke="#8884d8"
            strokeWidth={2}
            type="monotone"
          />
          <Brush dataKey="dateStr" height={30} stroke="#8884d8" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
