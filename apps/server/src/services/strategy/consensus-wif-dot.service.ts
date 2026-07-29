import {
  DEFAULT_CONSENSUS_STRATEGY_CONFIG,
  type StrategyConfig,
  type StrategyRiskMode,
  type StrategyWeekday,
} from "@trader/db";

const MINUTES = 60_000;
const EPSILON = 1e-9;

export interface StrategyRiskState {
  mode: StrategyRiskMode;
  initialEquity: number;
  equity: number;
  highWaterEquity: number;
  lastDeriskHighWaterEquity: number;
}

export interface WifEvaluationInput {
  symbol: "WIFUSDT";
  signalClosedAt: string;
  entryPrice: number;
  open: number;
  high: number;
  low: number;
  close: number;
  atr: number;
  move45mAtr: number;
  volumeZ: number;
  takerImbalance: number;
  oiZ: number;
  premiumZ: number;
}

export interface DotEvaluationInput {
  symbol: "DOTUSDT";
  fundingTime: string;
  evaluatedAt: string;
  fundingRateBps: number;
  entryPrice: number;
  atr: number;
}

export interface StrategySignalPlan {
  module: "wif_oi_flush" | "dot_negative_funding";
  symbol: "WIFUSDT" | "DOTUSDT";
  side: "long";
  strength: number;
  rawStrength: number;
  reason: string;
  entryPrice: number;
  atr: number;
  stopAtr: number;
  targetR: number;
  maxHoldMinutes: number;
  signalTime: string;
}

export interface PositionPlan {
  symbol: StrategySignalPlan["symbol"];
  side: "long";
  riskMode: StrategyRiskMode;
  riskPercent: number;
  entryPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  stopDistancePercent: number;
  riskDistancePercent: number;
  requestedNotional: number;
  cappedNotional: number;
  quantity: number;
  maxGrossLeverage: number;
}

export interface EvaluateStrategyInput {
  config?: StrategyConfig;
  state: StrategyRiskState;
  equity: number;
  openGrossNotional: number;
  wif?: WifEvaluationInput;
  dot?: DotEvaluationInput;
}

export interface EvaluateStrategyResult {
  config: StrategyConfig;
  state: StrategyRiskState;
  signals: Array<{
    signal: StrategySignalPlan;
    position: PositionPlan;
  }>;
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
}

function weekdayMondayZero(value: string): StrategyWeekday {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  // JavaScript: Sunday=0. Strategy convention: Monday=0.
  return ((date.getUTCDay() + 6) % 7) as StrategyWeekday;
}

function scoreToPercent(rawStrength: number): number {
  return Math.max(0, Math.min(100, Math.round((rawStrength / 8) * 100)));
}

function cloneDefaultConfig(): StrategyConfig {
  return structuredClone(DEFAULT_CONSENSUS_STRATEGY_CONFIG);
}

export const consensusWifDotService = {
  getDefaultConfig(): StrategyConfig {
    return cloneDefaultConfig();
  },

  createInitialRiskState(initialEquity: number): StrategyRiskState {
    assertFinitePositive(initialEquity, "initialEquity");
    return {
      mode: "base",
      initialEquity,
      equity: initialEquity,
      highWaterEquity: initialEquity,
      lastDeriskHighWaterEquity: initialEquity,
    };
  },

  transitionRiskState(
    state: StrategyRiskState,
    equity: number,
    config: StrategyConfig = DEFAULT_CONSENSUS_STRATEGY_CONFIG
  ): StrategyRiskState {
    assertFinitePositive(state.initialEquity, "state.initialEquity");
    assertFinitePositive(equity, "equity");

    const highWaterEquity = Math.max(state.highWaterEquity, equity);
    const drawdownPercent =
      highWaterEquity > 0 ? (1 - equity / highWaterEquity) * 100 : 100;
    const profitPercent = (equity / state.initialEquity - 1) * 100;

    if (
      state.mode === "stopped" ||
      drawdownPercent + EPSILON >= config.risk.hardStopDrawdownPercent
    ) {
      return {
        ...state,
        mode: "stopped",
        equity,
        highWaterEquity,
      };
    }

    if (
      state.mode === "boost" &&
      drawdownPercent + EPSILON >= config.risk.deRiskDrawdownPercent
    ) {
      return {
        ...state,
        mode: "base",
        equity,
        highWaterEquity,
        lastDeriskHighWaterEquity: highWaterEquity,
      };
    }

    const atHighWater = Math.abs(equity - highWaterEquity) <= EPSILON;
    const recoveredAfterDerisk =
      equity + EPSILON >= state.lastDeriskHighWaterEquity;

    if (
      state.mode === "base" &&
      profitPercent + EPSILON >= config.risk.boostTriggerProfitPercent &&
      atHighWater &&
      recoveredAfterDerisk
    ) {
      return {
        ...state,
        mode: "boost",
        equity,
        highWaterEquity,
      };
    }

    return {
      ...state,
      equity,
      highWaterEquity,
    };
  },

  evaluateWif(
    input: WifEvaluationInput,
    config: StrategyConfig = DEFAULT_CONSENSUS_STRATEGY_CONFIG
  ): StrategySignalPlan | null {
    if (!config.wif.enabled || input.symbol !== config.wif.symbol) {
      return null;
    }

    assertFinitePositive(input.entryPrice, "wif.entryPrice");
    assertFinitePositive(input.atr, "wif.atr");

    const weekday = weekdayMondayZero(input.signalClosedAt);
    if (!config.wif.allowedWeekdaysUtc.includes(weekday)) {
      return null;
    }

    const candleRange = input.high - input.low;
    if (!Number.isFinite(candleRange) || candleRange <= 0) {
      return null;
    }

    const lowerWick = Math.min(input.open, input.close) - input.low;
    const lowerWickRatio = lowerWick / candleRange;
    const closeLocation = (input.close - input.low) / candleRange;
    const rawStrength =
      Math.abs(input.move45mAtr) +
      Math.max(-input.oiZ, 0) / 2 +
      Math.max(-input.premiumZ, 0) / 2;

    const passes =
      input.move45mAtr <= config.wif.move45mAtrMax &&
      input.volumeZ >= config.wif.volumeZMin &&
      lowerWickRatio >= config.wif.lowerWickRatioMin &&
      closeLocation >= config.wif.closeLocationMin &&
      input.takerImbalance >= config.wif.takerImbalanceMin &&
      input.oiZ <= config.wif.oiZMax &&
      rawStrength >= config.wif.strengthMin;

    if (!passes) {
      return null;
    }

    return {
      module: "wif_oi_flush",
      symbol: config.wif.symbol,
      side: "long",
      strength: scoreToPercent(rawStrength),
      rawStrength,
      reason: [
        `45m move ${input.move45mAtr.toFixed(2)} ATR`,
        `OI z ${input.oiZ.toFixed(2)}`,
        `volume z ${input.volumeZ.toFixed(2)}`,
        `reclaim ${(closeLocation * 100).toFixed(0)}%`,
        `consensus weekday ${weekday}`,
      ].join("; "),
      entryPrice: input.entryPrice,
      atr: input.atr,
      stopAtr: config.wif.stopAtr,
      targetR: config.wif.targetR,
      maxHoldMinutes: config.wif.maxHoldMinutes,
      signalTime: input.signalClosedAt,
    };
  },

  evaluateDot(
    input: DotEvaluationInput,
    config: StrategyConfig = DEFAULT_CONSENSUS_STRATEGY_CONFIG
  ): StrategySignalPlan | null {
    if (!config.dot.enabled || input.symbol !== config.dot.symbol) {
      return null;
    }

    assertFinitePositive(input.entryPrice, "dot.entryPrice");
    assertFinitePositive(input.atr, "dot.atr");

    const fundingTime = new Date(input.fundingTime);
    const evaluatedAt = new Date(input.evaluatedAt);
    if (
      Number.isNaN(fundingTime.getTime()) ||
      Number.isNaN(evaluatedAt.getTime())
    ) {
      throw new Error("Invalid DOT funding timestamps");
    }

    const delayMinutes =
      (evaluatedAt.getTime() - fundingTime.getTime()) / MINUTES;
    if (
      delayMinutes + EPSILON < config.dot.entryDelayMinutes ||
      delayMinutes - EPSILON > config.dot.entryDelayMinutes + 15
    ) {
      return null;
    }

    const weekday = weekdayMondayZero(input.fundingTime);
    const threshold = config.dot.weekdayFundingThresholdBps[weekday];
    if (threshold === undefined || input.fundingRateBps > threshold) {
      return null;
    }

    const rawStrength = Math.abs(input.fundingRateBps);

    return {
      module: "dot_negative_funding",
      symbol: config.dot.symbol,
      side: "long",
      strength: scoreToPercent(rawStrength * 2),
      rawStrength,
      reason: [
        `known funding ${input.fundingRateBps.toFixed(2)} bps`,
        `weekday threshold ${threshold.toFixed(2)} bps`,
        `entry delay ${delayMinutes.toFixed(0)}m`,
      ].join("; "),
      entryPrice: input.entryPrice,
      atr: input.atr,
      stopAtr: config.dot.stopAtr,
      targetR: config.dot.targetR,
      maxHoldMinutes: config.dot.maxHoldMinutes,
      signalTime: input.fundingTime,
    };
  },

  getRiskPercent(
    signal: StrategySignalPlan,
    state: StrategyRiskState,
    config: StrategyConfig = DEFAULT_CONSENSUS_STRATEGY_CONFIG
  ): number {
    if (state.mode === "stopped") {
      return 0;
    }

    if (signal.module === "wif_oi_flush") {
      return state.mode === "boost"
        ? config.risk.boostWifRiskPercent
        : config.risk.baseWifRiskPercent;
    }

    return state.mode === "boost"
      ? config.risk.boostDotRiskPercent
      : config.risk.baseDotRiskPercent;
  },

  calculatePositionPlan(
    signal: StrategySignalPlan,
    state: StrategyRiskState,
    equity: number,
    openGrossNotional: number,
    config: StrategyConfig = DEFAULT_CONSENSUS_STRATEGY_CONFIG
  ): PositionPlan {
    assertFinitePositive(equity, "equity");
    if (!Number.isFinite(openGrossNotional) || openGrossNotional < 0) {
      throw new Error("openGrossNotional must be non-negative");
    }

    const riskPercent = this.getRiskPercent(signal, state, config);
    const stopDistance = signal.stopAtr * signal.atr;
    const stopDistancePercent = (stopDistance / signal.entryPrice) * 100;
    const stopPrice = Math.max(
      Number.EPSILON,
      signal.entryPrice - stopDistance
    );
    const takeProfitPrice = signal.entryPrice + stopDistance * signal.targetR;
    const costPercent = config.execution.roundTurnCostBps / 100;
    const riskDistancePercent = stopDistancePercent + costPercent;

    const requestedNotional =
      riskPercent > 0 && riskDistancePercent > 0
        ? (equity * (riskPercent / 100)) / (riskDistancePercent / 100)
        : 0;
    const remainingGross = Math.max(
      0,
      equity * config.execution.maxGrossLeverage - openGrossNotional
    );
    const cappedNotional = Math.min(requestedNotional, remainingGross);
    const quantity = cappedNotional / signal.entryPrice;

    return {
      symbol: signal.symbol,
      side: "long",
      riskMode: state.mode,
      riskPercent,
      entryPrice: signal.entryPrice,
      stopPrice,
      takeProfitPrice,
      stopDistancePercent,
      riskDistancePercent,
      requestedNotional,
      cappedNotional,
      quantity,
      maxGrossLeverage: config.execution.maxGrossLeverage,
    };
  },

  evaluate(input: EvaluateStrategyInput): EvaluateStrategyResult {
    const config = input.config ?? this.getDefaultConfig();
    const state = this.transitionRiskState(input.state, input.equity, config);

    if (state.mode === "stopped") {
      return { config, state, signals: [] };
    }

    const rawSignals = [
      input.wif ? this.evaluateWif(input.wif, config) : null,
      input.dot ? this.evaluateDot(input.dot, config) : null,
    ].filter((signal): signal is StrategySignalPlan => signal !== null);

    let runningGrossNotional = input.openGrossNotional;
    const signals = rawSignals
      .slice(0, config.execution.maxPositions)
      .map((signal) => {
        const position = this.calculatePositionPlan(
          signal,
          state,
          input.equity,
          runningGrossNotional,
          config
        );
        runningGrossNotional += position.cappedNotional;
        return { signal, position };
      })
      .filter((candidate) => candidate.position.quantity > 0);

    return { config, state, signals };
  },
};
