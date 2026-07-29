import { describe, expect, test } from "bun:test";
import { buildEquityCurve } from "./dashboard";

describe("buildEquityCurve", () => {
  test("accumulates closed trades and ends at current equity", () => {
    const points = buildEquityCurve({
      initialEquity: 10_000,
      currentEquity: 10_125,
      trades: [
        { closedAt: new Date("2026-01-02T00:00:00.000Z"), pnlUsdt: 100 },
        { closedAt: new Date("2026-01-03T00:00:00.000Z"), pnlUsdt: -25 },
      ],
      now: new Date("2026-01-04T00:00:00.000Z"),
    });

    expect(points.map((point) => point.equity)).toEqual([
      10_000, 10_100, 10_075, 10_125,
    ]);
    expect(points.at(-1)?.pnl).toBe(125);
  });

  test("returns a flat two-point curve before the first trade", () => {
    const points = buildEquityCurve({
      initialEquity: 10_000,
      currentEquity: 10_000,
      trades: [],
      now: new Date("2026-01-04T00:00:00.000Z"),
    });

    expect(points).toHaveLength(2);
    expect(points.every((point) => point.equity === 10_000)).toBe(true);
  });
});
