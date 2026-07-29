"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

interface EquityPoint {
  time: string;
  equity: number;
  pnl: number;
}

interface EquityCurveChartProps {
  data: EquityPoint[];
}

const chartConfig = {
  equity: {
    label: "Капитал",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const axisMoney = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactMoney = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
});

const exactDate = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function EquityCurveChart({ data }: EquityCurveChartProps) {
  const values = data.map((point) => point.equity);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.12, maximum * 0.005, 1);

  return (
    <ChartContainer
      className="aspect-auto h-[280px] w-full"
      config={chartConfig}
    >
      <AreaChart accessibilityLayer data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="time"
          minTickGap={28}
          tickFormatter={(value: string) => shortDate.format(new Date(value))}
          tickLine={false}
        />
        <YAxis
          axisLine={false}
          domain={[minimum - padding, maximum + padding]}
          tickFormatter={(value: number) => axisMoney.format(value)}
          tickLine={false}
          width={72}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <div className="flex min-w-32 items-center justify-between gap-3">
                  <span className="text-muted-foreground">Капитал</span>
                  <span className="font-medium font-mono tabular-nums">
                    {exactMoney.format(Number(value))}
                  </span>
                </div>
              )}
              labelFormatter={(_, payload) => {
                const time = payload[0]?.payload?.time;
                return time ? exactDate.format(new Date(time)) : "";
              }}
            />
          }
          cursor={false}
        />
        <Area
          dataKey="equity"
          fill="var(--color-equity)"
          fillOpacity={0.14}
          stroke="var(--color-equity)"
          strokeWidth={2}
          type="monotone"
        />
      </AreaChart>
    </ChartContainer>
  );
}
