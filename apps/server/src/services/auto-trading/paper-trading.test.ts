import { describe, expect, test } from "bun:test";
import { calculatePaperPnl } from "./paper-trading";

describe("calculatePaperPnl", () => {
  test("subtracts round-trip costs from a winning long trade", () => {
    expect(
      calculatePaperPnl({ entryPrice: 10, exitPrice: 11, notional: 1000 })
    ).toEqual({ percent: 9.8, usdt: 98 });
  });

  test("keeps losses negative after costs", () => {
    expect(
      calculatePaperPnl({ entryPrice: 10, exitPrice: 9, notional: 1000 })
    ).toEqual({ percent: -10.2, usdt: -102 });
  });

  test("rejects invalid prices", () => {
    expect(() =>
      calculatePaperPnl({ entryPrice: 0, exitPrice: 9, notional: 1000 })
    ).toThrow("Paper trade prices must be positive");
  });
});
