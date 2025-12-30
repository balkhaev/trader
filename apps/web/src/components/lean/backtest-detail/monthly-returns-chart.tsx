"use client";

import { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { calculateMonthlyReturns } from "@/lib/backtest-utils";

interface MonthlyReturnsChartProps {
  equity: Array<{ date: number; value: number }>;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function MonthlyReturnsChart({ equity }: MonthlyReturnsChartProps) {
  const [variant, setVariant] = useState<"bar" | "heatmap">("heatmap");
  const monthlyReturns = useMemo(
    () => calculateMonthlyReturns(equity),
    [equity]
  );

  const chartData = useMemo(() => {
    return monthlyReturns.map((mr) => ({
      label: `${MONTHS[mr.month]} ${mr.year}`,
      return: mr.return,
      isPositive: mr.return >= 0,
    }));
  }, [monthlyReturns]);

  if (monthlyReturns.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Not enough data for monthly returns
      </div>
    );
  }

  const years = [...new Set(monthlyReturns.map((m) => m.year))].sort();

  const getColor = (val: number | null) => {
    if (val === null) return "bg-muted";
    if (val > 5) return "bg-green-600";
    if (val > 2) return "bg-green-500";
    if (val > 0) return "bg-green-400";
    if (val > -2) return "bg-red-400";
    if (val > -5) return "bg-red-500";
    return "bg-red-600";
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button
          onClick={() => setVariant("heatmap")}
          size="sm"
          variant={variant === "heatmap" ? "default" : "outline"}
        >
          Heatmap
        </Button>
        <Button
          onClick={() => setVariant("bar")}
          size="sm"
          variant={variant === "bar" ? "default" : "outline"}
        >
          Bar Chart
        </Button>
      </div>

      {variant === "heatmap" ? (
        <div className="space-y-2 overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-13 gap-1 text-xs">
            <div className="font-medium">Year</div>
            {MONTHS.map((m) => (
              <div className="text-center font-medium" key={m}>
                {m}
              </div>
            ))}
          </div>
          {years.map((year) => (
            <div className="grid min-w-[700px] grid-cols-13 gap-1" key={year}>
              <div className="flex items-center font-medium text-xs">
                {year}
              </div>
              {MONTHS.map((_, monthIndex) => {
                const data = monthlyReturns.find(
                  (mr) => mr.year === year && mr.month === monthIndex
                );
                const value = data?.return ?? null;

                return (
                  <div
                    className={`flex h-8 items-center justify-center rounded font-mono text-xs ${getColor(value)} ${value !== null ? "text-white" : ""}`}
                    key={monthIndex}
                    title={value !== null ? `${value.toFixed(2)}%` : "No data"}
                  >
                    {value !== null ? value.toFixed(1) : "-"}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            <span className="text-muted-foreground">Legend:</span>
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded bg-red-600" />
              <span>&lt;-5%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded bg-red-400" />
              <span>-5% to 0%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded bg-green-400" />
              <span>0% to 2%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded bg-green-500" />
              <span>2% to 5%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded bg-green-600" />
              <span>&gt;5%</span>
            </div>
          </div>
        </div>
      ) : (
        <ResponsiveContainer height={300} width="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
            <XAxis
              angle={-45}
              dataKey="label"
              fontSize={10}
              height={60}
              interval={0}
              textAnchor="end"
              tick={{ fill: "#888" }}
            />
            <YAxis
              fontSize={12}
              tick={{ fill: "#888" }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={50}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0]?.payload;
                  if (!d) return null;
                  return (
                    <div className="rounded border bg-background p-2 shadow-lg">
                      <p className="font-medium">{d.label}</p>
                      <p
                        className={
                          d.isPositive ? "text-green-500" : "text-red-500"
                        }
                      >
                        {d.return.toFixed(2)}%
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="return" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  fill={entry.isPositive ? "#22c55e" : "#ef4444"}
                  key={`cell-${index}`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
