"use client";

import {
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  EfficientFrontierPoint,
  OptimizationResult,
} from "@/hooks/use-portfolio-optimization";

interface EfficientFrontierChartProps {
  data: EfficientFrontierPoint[] | null;
  currentPortfolio?: OptimizationResult | null;
  loading?: boolean;
}

export function EfficientFrontierChart({
  data,
  currentPortfolio,
  loading = false,
}: EfficientFrontierChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Efficient Frontier</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[300px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Efficient Frontier</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground text-sm">
            Выберите символы и запустите оптимизацию для отображения границы
            эффективности
          </div>
        </CardContent>
      </Card>
    );
  }

  // Find max sharpe and min volatility points
  const maxSharpePoint = data.reduce(
    (max, p) => (p.sharpe > max.sharpe ? p : max),
    data[0]
  );
  const minVolPoint = data.reduce(
    (min, p) => (p.volatility < min.volatility ? p : min),
    data[0]
  );

  // Transform data for chart
  const chartData = data.map((point) => ({
    x: point.volatility * 100,
    y: point.return * 100,
    sharpe: point.sharpe,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Efficient Frontier</span>
          <div className="flex gap-4 font-normal text-xs">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-green-500" />
              Max Sharpe
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-blue-500" />
              Min Vol
            </span>
            {currentPortfolio && (
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full bg-orange-500" />
                Current
              </span>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer height={300} width="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
            <CartesianGrid className="stroke-muted" strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              domain={["auto", "auto"]}
              label={{
                value: "Volatility (%)",
                position: "bottom",
                fontSize: 11,
                offset: 0,
              }}
              name="Volatility"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => v.toFixed(1)}
              type="number"
              unit="%"
            />
            <YAxis
              dataKey="y"
              domain={["auto", "auto"]}
              label={{
                value: "Return (%)",
                angle: -90,
                position: "left",
                fontSize: 11,
                offset: 10,
              }}
              name="Return"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => v.toFixed(1)}
              type="number"
              unit="%"
            />
            <Tooltip
              content={({ payload }) => {
                if (!payload || payload.length === 0) {
                  return null;
                }
                const point = payload[0].payload;
                return (
                  <div className="rounded bg-popover p-2 text-xs shadow-lg ring-1 ring-border">
                    <div>Return: {point.y.toFixed(2)}%</div>
                    <div>Volatility: {point.x.toFixed(2)}%</div>
                    <div>Sharpe: {point.sharpe.toFixed(2)}</div>
                  </div>
                );
              }}
              cursor={{ strokeDasharray: "3 3" }}
            />
            <Scatter
              data={chartData}
              fill="hsl(var(--primary))"
              fillOpacity={0.6}
              name="Frontier"
              r={3}
            />
            {/* Max Sharpe point */}
            <ReferenceDot
              fill="#22c55e"
              r={6}
              stroke="#fff"
              strokeWidth={2}
              x={maxSharpePoint.volatility * 100}
              y={maxSharpePoint.return * 100}
            />
            {/* Min Volatility point */}
            <ReferenceDot
              fill="#3b82f6"
              r={6}
              stroke="#fff"
              strokeWidth={2}
              x={minVolPoint.volatility * 100}
              y={minVolPoint.return * 100}
            />
            {/* Current portfolio point */}
            {currentPortfolio && (
              <ReferenceDot
                fill="#f97316"
                r={8}
                stroke="#fff"
                strokeWidth={2}
                x={currentPortfolio.volatility * 100}
                y={currentPortfolio.expected_return * 100}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
