export interface ClosedEquityTrade {
  closedAt: Date;
  pnlUsdt: number;
}

export interface EquityCurvePoint {
  time: string;
  equity: number;
  pnl: number;
}

interface BuildEquityCurveInput {
  initialEquity: number;
  currentEquity: number;
  trades: ClosedEquityTrade[];
  now?: Date;
}

export function buildEquityCurve({
  initialEquity,
  currentEquity,
  trades,
  now = new Date(),
}: BuildEquityCurveInput): EquityCurvePoint[] {
  const orderedTrades = [...trades].sort(
    (left, right) => left.closedAt.getTime() - right.closedAt.getTime()
  );
  const firstTradeTime = orderedTrades[0]?.closedAt.getTime();
  const startTime = firstTradeTime
    ? firstTradeTime - 1
    : now.getTime() - 60_000;
  const points: EquityCurvePoint[] = [
    {
      time: new Date(startTime).toISOString(),
      equity: initialEquity,
      pnl: 0,
    },
  ];
  let equity = initialEquity;

  for (const trade of orderedTrades) {
    equity += trade.pnlUsdt;
    points.push({
      time: trade.closedAt.toISOString(),
      equity,
      pnl: equity - initialEquity,
    });
  }

  const lastTime = new Date(points.at(-1)?.time ?? startTime).getTime();
  points.push({
    time: new Date(Math.max(now.getTime(), lastTime + 1)).toISOString(),
    equity: currentEquity,
    pnl: currentEquity - initialEquity,
  });
  return points;
}
