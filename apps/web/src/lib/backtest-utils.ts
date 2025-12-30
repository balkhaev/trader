// Типы
export interface EquityPoint {
  date: number;
  value: number;
}

export interface Trade {
  id: string;
  time: number;
  symbol: string;
  direction: "buy" | "sell";
  price: number;
  quantity: number;
  profit?: number;
}

export interface DrawdownPoint {
  date: number;
  drawdown: number;
  peak: number;
}

export interface MonthlyReturn {
  year: number;
  month: number;
  return: number;
}

export interface RollingSharpePoint {
  date: number;
  sharpe: number;
}

// Вычисление Drawdown из equity curve
export function calculateDrawdown(equity: EquityPoint[]): DrawdownPoint[] {
  if (!equity.length) return [];

  let peak = equity[0].value;
  return equity.map((point) => {
    if (point.value > peak) peak = point.value;
    const drawdown = peak > 0 ? ((peak - point.value) / peak) * 100 : 0;
    return { date: point.date, drawdown, peak };
  });
}

// Вычисление месячных возвратов
export function calculateMonthlyReturns(
  equity: EquityPoint[]
): MonthlyReturn[] {
  if (equity.length < 2) return [];

  const monthlyData = new Map<string, { start: number; end: number }>();

  for (const point of equity) {
    const date = new Date(point.date);
    const key = `${date.getFullYear()}-${date.getMonth()}`;

    const existing = monthlyData.get(key);
    if (existing) {
      existing.end = point.value;
    } else {
      monthlyData.set(key, { start: point.value, end: point.value });
    }
  }

  return Array.from(monthlyData.entries()).map(([key, data]) => {
    const [year, month] = key.split("-").map(Number);
    const returnPct =
      data.start > 0 ? ((data.end - data.start) / data.start) * 100 : 0;
    return { year: year!, month: month!, return: returnPct };
  });
}

// Вычисление дневных возвратов для гистограммы
export function calculateDailyReturns(equity: EquityPoint[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prevValue = equity[i - 1]!.value;
    const currValue = equity[i]!.value;
    if (prevValue > 0) {
      returns.push(((currValue - prevValue) / prevValue) * 100);
    }
  }
  return returns;
}

// Rolling Sharpe Ratio
export function calculateRollingSharpe(
  equity: EquityPoint[],
  window = 30,
  riskFreeRate = 0.02
): RollingSharpePoint[] {
  const dailyReturns = calculateDailyReturns(equity);
  const result: RollingSharpePoint[] = [];

  if (dailyReturns.length < window) return result;

  for (let i = window; i < dailyReturns.length; i++) {
    const windowReturns = dailyReturns.slice(i - window, i);
    const mean = windowReturns.reduce((a, b) => a + b, 0) / window;
    const variance =
      windowReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / window;
    const std = Math.sqrt(variance);

    const annualizedSharpe =
      std > 0 ? (mean * 252 - riskFreeRate) / (std * Math.sqrt(252)) : 0;

    result.push({ date: equity[i]!.date, sharpe: annualizedSharpe });
  }

  return result;
}

// Расчет прибыли по сделкам (парирование buy/sell)
export function calculateTradeProfit(trades: Trade[]): Trade[] {
  const sortedTrades = [...trades].sort((a, b) => a.time - b.time);
  const openPositions = new Map<string, { price: number; quantity: number }>();

  return sortedTrades.map((trade) => {
    const key = trade.symbol;

    if (trade.direction === "buy") {
      const existing = openPositions.get(key);
      if (existing) {
        const totalQty = existing.quantity + Math.abs(trade.quantity);
        const avgPrice =
          (existing.price * existing.quantity +
            trade.price * Math.abs(trade.quantity)) /
          totalQty;
        openPositions.set(key, { price: avgPrice, quantity: totalQty });
      } else {
        openPositions.set(key, {
          price: trade.price,
          quantity: Math.abs(trade.quantity),
        });
      }
      return { ...trade, profit: 0 };
    }

    // sell
    const position = openPositions.get(key);
    if (position) {
      const profit = (trade.price - position.price) * Math.abs(trade.quantity);
      const remainingQty = position.quantity - Math.abs(trade.quantity);

      if (remainingQty > 0) {
        openPositions.set(key, { ...position, quantity: remainingQty });
      } else {
        openPositions.delete(key);
      }

      return { ...trade, profit };
    }

    return { ...trade, profit: 0 };
  });
}

// Экспорт в CSV
export function exportTradesToCSV(trades: Trade[]): string {
  const headers = [
    "Date",
    "Symbol",
    "Direction",
    "Price",
    "Quantity",
    "Profit",
  ];
  const rows = trades.map((t) => [
    new Date(t.time).toISOString(),
    t.symbol,
    t.direction,
    t.price.toString(),
    t.quantity.toString(),
    t.profit?.toFixed(2) ?? "",
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// Группировка статистик по категориям
export function groupStatistics(stats: Record<string, string>): {
  performance: Record<string, string>;
  risk: Record<string, string>;
  trades: Record<string, string>;
  other: Record<string, string>;
} {
  const performanceKeys = [
    "Net Profit",
    "Compounding Annual Return",
    "Total Return",
    "Annual Return",
    "Alpha",
    "Beta",
    "Information Ratio",
    "Expectancy",
  ];

  const riskKeys = [
    "Sharpe Ratio",
    "Sortino Ratio",
    "Drawdown",
    "Max Drawdown",
    "Annual Standard Deviation",
    "Value at Risk",
    "Probabilistic Sharpe Ratio",
    "Treynor Ratio",
  ];

  const tradeKeys = [
    "Total Orders",
    "Win Rate",
    "Profit-Loss Ratio",
    "Average Win",
    "Average Loss",
    "Largest Win",
    "Largest Loss",
    "Total Fees",
    "Average Duration",
  ];

  const result = {
    performance: {} as Record<string, string>,
    risk: {} as Record<string, string>,
    trades: {} as Record<string, string>,
    other: {} as Record<string, string>,
  };

  for (const [key, value] of Object.entries(stats)) {
    if (performanceKeys.some((k) => key.includes(k))) {
      result.performance[key] = value;
    } else if (riskKeys.some((k) => key.includes(k))) {
      result.risk[key] = value;
    } else if (tradeKeys.some((k) => key.includes(k))) {
      result.trades[key] = value;
    } else {
      result.other[key] = value;
    }
  }

  return result;
}

// Форматирование числа для отображения
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Определение цвета для значения
export function getValueColor(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "";
}
