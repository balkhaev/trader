const DEFAULT_ROUND_TRIP_COST_BPS = 20;

interface PaperPnlInput {
  entryPrice: number;
  exitPrice: number;
  notional: number;
  roundTripCostBps?: number;
}

export function calculatePaperPnl({
  entryPrice,
  exitPrice,
  notional,
  roundTripCostBps = DEFAULT_ROUND_TRIP_COST_BPS,
}: PaperPnlInput): { percent: number; usdt: number } {
  if (entryPrice <= 0 || exitPrice <= 0 || notional < 0) {
    throw new Error(
      "Paper trade prices must be positive and notional non-negative"
    );
  }
  const grossPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
  const percent = grossPercent - roundTripCostBps / 100;
  return { percent, usdt: (notional * percent) / 100 };
}
