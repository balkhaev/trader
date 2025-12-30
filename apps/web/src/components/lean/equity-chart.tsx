"use client";

import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface EquityChartProps {
  data: Array<{ date: number; value: number }>;
}

export function EquityChart({ data }: EquityChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No equity data available
      </div>
    );
  }

  const formattedData = data.map((d) => ({
    ...d,
    dateStr: new Date(d.date).toLocaleDateString(),
  }));

  const minValue = Math.min(...data.map((d) => d.value));
  const maxValue = Math.max(...data.map((d) => d.value));
  const startValue = data[0]?.value ?? 0;
  const endValue = data[data.length - 1]?.value ?? 0;
  const isPositive = endValue >= startValue;
  const totalReturn =
    startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;

  return (
    <ResponsiveContainer height={350} width="100%">
      <AreaChart data={formattedData}>
        <defs>
          <linearGradient id="equityGradient" x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="5%"
              stopColor={isPositive ? "#22c55e" : "#ef4444"}
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor={isPositive ? "#22c55e" : "#ef4444"}
              stopOpacity={0}
            />
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
          domain={[minValue * 0.95, maxValue * 1.05]}
          fontSize={12}
          tick={{ fill: "#888" }}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          tickLine={false}
          width={70}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (active && payload && payload.length) {
              const d = payload[0]?.payload;
              if (!d) return null;
              const changeFromStart =
                startValue > 0
                  ? ((d.value - startValue) / startValue) * 100
                  : 0;
              return (
                <div className="rounded border bg-background p-2 shadow-lg">
                  <p className="text-sm">{d.dateStr}</p>
                  <p className="font-bold">${d.value.toFixed(2)}</p>
                  <p
                    className={`text-xs ${changeFromStart >= 0 ? "text-green-500" : "text-red-500"}`}
                  >
                    {changeFromStart >= 0 ? "+" : ""}
                    {changeFromStart.toFixed(2)}% from start
                  </p>
                </div>
              );
            }
            return null;
          }}
        />
        <Area
          dataKey="value"
          fill="url(#equityGradient)"
          stroke={isPositive ? "#22c55e" : "#ef4444"}
          strokeWidth={2}
          type="monotone"
        />
        <Brush
          dataKey="dateStr"
          fill="#f5f5f5"
          height={30}
          stroke={isPositive ? "#22c55e" : "#ef4444"}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
