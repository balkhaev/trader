import { describe, expect, test } from "bun:test";
import { consensusWifDotService } from "./consensus-wif-dot.service";

describe("Consensus WIF + DOT strategy", () => {
  test("accepts a researched WIF reclaim and rejects a wrong weekday", () => {
    const passing = consensusWifDotService.evaluateWif({
      symbol: "WIFUSDT",
      signalClosedAt: "2026-07-28T10:00:00.000Z",
      entryPrice: 1,
      open: 1,
      high: 1.02,
      low: 0.9,
      close: 0.99,
      atr: 0.03,
      move45mAtr: -2.4,
      volumeZ: 1.5,
      takerImbalance: -0.05,
      oiZ: -1.4,
      premiumZ: -1,
    });
    expect(passing?.module).toBe("wif_oi_flush");

    const rejected = consensusWifDotService.evaluateWif({
      symbol: "WIFUSDT",
      signalClosedAt: "2026-07-29T10:00:00.000Z",
      entryPrice: 1,
      open: 1,
      high: 1.02,
      low: 0.9,
      close: 0.99,
      atr: 0.03,
      move45mAtr: -2.4,
      volumeZ: 1.5,
      takerImbalance: -0.05,
      oiZ: -1.4,
      premiumZ: -1,
    });
    expect(rejected).toBeNull();
  });

  test("uses only already-known DOT funding and weekday thresholds", () => {
    const signal = consensusWifDotService.evaluateDot({
      symbol: "DOTUSDT",
      fundingTime: "2026-07-27T08:00:00.000Z",
      evaluatedAt: "2026-07-27T08:15:00.000Z",
      fundingRateBps: -2.4,
      entryPrice: 4,
      atr: 0.08,
    });
    expect(signal?.module).toBe("dot_negative_funding");

    const tooEarly = consensusWifDotService.evaluateDot({
      symbol: "DOTUSDT",
      fundingTime: "2026-07-27T08:00:00.000Z",
      evaluatedAt: "2026-07-27T08:05:00.000Z",
      fundingRateBps: -3,
      entryPrice: 4,
      atr: 0.08,
    });
    expect(tooEarly).toBeNull();
  });

  test("boosts only at a new high and de-risks after drawdown", () => {
    const initial = consensusWifDotService.createInitialRiskState(10_000);
    const boosted = consensusWifDotService.transitionRiskState(initial, 11_500);
    expect(boosted.mode).toBe("boost");

    const derisked = consensusWifDotService.transitionRiskState(
      boosted,
      10_500
    );
    expect(derisked.mode).toBe("base");

    const stopped = consensusWifDotService.transitionRiskState(derisked, 9_700);
    expect(stopped.mode).toBe("stopped");
  });

  test("sizes against stop plus costs and caps total gross", () => {
    const state = consensusWifDotService.createInitialRiskState(10_000);
    const signal = consensusWifDotService.evaluateDot({
      symbol: "DOTUSDT",
      fundingTime: "2026-07-27T08:00:00.000Z",
      evaluatedAt: "2026-07-27T08:15:00.000Z",
      fundingRateBps: -3,
      entryPrice: 4,
      atr: 0.08,
    });
    expect(signal).not.toBeNull();
    const position = consensusWifDotService.calculatePositionPlan(
      signal!,
      state,
      10_000,
      29_000
    );
    expect(position.cappedNotional).toBeLessThanOrEqual(1_000);
    expect(position.riskDistancePercent).toBeGreaterThan(
      position.stopDistancePercent
    );
  });
});
