"use client";

import {
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Trade {
  id: string;
  time: number;
  symbol: string;
  direction: "buy" | "sell";
  price: number;
  quantity: number;
}

interface TradesChartProps {
  trades: Trade[];
}

export function TradesChart({ trades }: TradesChartProps) {
  if (!trades || trades.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No trades data available
      </div>
    );
  }

  // Создаем данные для графика цены из сделок
  const sortedTrades = [...trades].sort((a, b) => a.time - b.time);
  const firstPrice = sortedTrades[0]?.price ?? 0;

  const priceData = sortedTrades.map((t, index) => {
    const prevPrice =
      index > 0 ? (sortedTrades[index - 1]?.price ?? t.price) : t.price;
    const changeFromPrev =
      prevPrice > 0 ? ((t.price - prevPrice) / prevPrice) * 100 : 0;
    const changeFromStart =
      firstPrice > 0 ? ((t.price - firstPrice) / firstPrice) * 100 : 0;

    return {
      time: t.time,
      dateStr: new Date(t.time).toLocaleDateString(),
      dateTimeStr: new Date(t.time).toLocaleString(),
      price: t.price,
      direction: t.direction,
      quantity: Math.abs(t.quantity),
      isBuy: t.direction === "buy",
      changeFromPrev,
      changeFromStart,
    };
  });

  const buyTrades = priceData.filter((t) => t.isBuy);
  const sellTrades = priceData.filter((t) => !t.isBuy);

  const minPrice = Math.min(...priceData.map((d) => d.price));
  const maxPrice = Math.max(...priceData.map((d) => d.price));

  // Статистика
  const totalBuys = buyTrades.length;
  const totalSells = sellTrades.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Total Trades: </span>
          <span className="font-medium font-mono">{priceData.length}</span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Buys: </span>
          <span className="font-medium font-mono text-green-500">
            {totalBuys}
          </span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Sells: </span>
          <span className="font-medium font-mono text-red-500">
            {totalSells}
          </span>
        </div>
        <div className="rounded bg-muted px-3 py-1">
          <span className="text-muted-foreground">Price Range: </span>
          <span className="font-medium font-mono">
            ${minPrice.toLocaleString()} - ${maxPrice.toLocaleString()}
          </span>
        </div>
      </div>

      <ResponsiveContainer height={400} width="100%">
        <ComposedChart data={priceData}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
          <XAxis
            dataKey="dateStr"
            fontSize={12}
            interval="preserveStartEnd"
            tick={{ fill: "#888" }}
            tickLine={false}
          />
          <YAxis
            domain={[minPrice * 0.95, maxPrice * 1.05]}
            fontSize={12}
            tick={{ fill: "#888" }}
            tickFormatter={(v: number) => `$${v.toLocaleString()}`}
            tickLine={false}
            width={80}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0]?.payload;
                if (!d) return null;
                return (
                  <div className="rounded border bg-background p-2 shadow-lg">
                    <p className="text-muted-foreground text-xs">
                      {d.dateTimeStr}
                    </p>
                    <p className="font-bold">${d.price.toLocaleString()}</p>
                    <p
                      className={`font-medium text-sm ${d.isBuy ? "text-green-500" : "text-red-500"}`}
                    >
                      {d.isBuy ? "BUY" : "SELL"} {d.quantity.toFixed(4)}
                    </p>
                    <div className="mt-1 border-t pt-1 text-xs">
                      <p
                        className={
                          d.changeFromPrev >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        vs prev: {d.changeFromPrev >= 0 ? "+" : ""}
                        {d.changeFromPrev.toFixed(2)}%
                      </p>
                      <p
                        className={
                          d.changeFromStart >= 0
                            ? "text-green-500"
                            : "text-red-500"
                        }
                      >
                        vs start: {d.changeFromStart >= 0 ? "+" : ""}
                        {d.changeFromStart.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                );
              }
              return null;
            }}
          />

          {/* Линия цены */}
          <Line
            connectNulls
            dataKey="price"
            dot={false}
            stroke="#888"
            strokeWidth={1}
            type="monotone"
          />

          {/* Точки покупок */}
          <Scatter
            data={buyTrades}
            dataKey="price"
            fill="#22c55e"
            name="Buy"
            shape={(props: { cx: number; cy: number }) => (
              <polygon
                fill="#22c55e"
                points={`${props.cx},${props.cy - 8} ${props.cx - 6},${props.cy + 4} ${props.cx + 6},${props.cy + 4}`}
              />
            )}
          />

          {/* Точки продаж */}
          <Scatter
            data={sellTrades}
            dataKey="price"
            fill="#ef4444"
            name="Sell"
            shape={(props: { cx: number; cy: number }) => (
              <polygon
                fill="#ef4444"
                points={`${props.cx},${props.cy + 8} ${props.cx - 6},${props.cy - 4} ${props.cx + 6},${props.cy - 4}`}
              />
            )}
          />

          <Brush dataKey="dateStr" fill="#f5f5f5" height={30} stroke="#888" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
