"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export type StrategyRiskMode = "base" | "boost" | "stopped";

export interface StrategyConfig {
  kind: "consensus_wif_dot_v1";
  name: string;
  description?: string;
  timeframe: "15m";
  execution: {
    venue: "binance_usdm";
    orderType: "market";
    roundTurnCostBps: number;
    maxPositions: 2;
    maxGrossLeverage: number;
    skipOvernight: true;
    skipFundingCrossing: true;
  };
  wif: {
    enabled: boolean;
    symbol: "WIFUSDT";
    allowedWeekdaysUtc: number[];
    move45mAtrMax: number;
    volumeZMin: number;
    lowerWickRatioMin: number;
    closeLocationMin: number;
    takerImbalanceMin: number;
    oiZMax: number;
    strengthMin: number;
    stopAtr: number;
    targetR: number;
    maxHoldMinutes: number;
  };
  dot: {
    enabled: boolean;
    symbol: "DOTUSDT";
    entryDelayMinutes: number;
    weekdayFundingThresholdBps: Record<string, number>;
    stopAtr: number;
    targetR: number;
    maxHoldMinutes: number;
  };
  risk: {
    baseWifRiskPercent: number;
    baseDotRiskPercent: number;
    boostWifRiskPercent: number;
    boostDotRiskPercent: number;
    boostTriggerProfitPercent: number;
    deRiskDrawdownPercent: number;
    hardStopDrawdownPercent: number;
  };
  runtime?: {
    mode: StrategyRiskMode;
    initialEquity: number;
    equity: number;
    highWaterEquity: number;
    lastDeriskHighWaterEquity: number;
    updatedAt: string;
  };
  validation?: {
    startedAt: string;
  };
}

export interface Strategy {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config: StrategyConfig;
  isActive: boolean;
  leanCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  nextRunAt: string | null;
}

async function fetchWithAuth<T>(endpoint: string, options?: RequestInit) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new Error(error.error || "Request failed");
  }
  return response.json() as Promise<T>;
}

export function useCanonicalStrategy() {
  return useQuery({
    queryKey: ["strategy", "canonical"],
    queryFn: () => fetchWithAuth<Strategy>("/api/strategy/canonical"),
    refetchInterval: 30_000,
  });
}

export function useDefaultStrategy() {
  return useQuery({
    queryKey: ["strategy", "default"],
    queryFn: () =>
      fetchWithAuth<{ config: StrategyConfig }>("/api/strategy/default"),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useStrategyStatus() {
  return useQuery({
    queryKey: ["strategy", "status"],
    queryFn: () =>
      fetchWithAuth<{ scheduler: SchedulerStatus }>("/api/strategy/status"),
    refetchInterval: 30_000,
  });
}

export function useUpdateStrategy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      strategyId,
      config,
    }: {
      strategyId: string;
      config: Partial<StrategyConfig>;
    }) =>
      fetchWithAuth<{ success: boolean; strategy: Strategy }>(
        `/api/strategy/${strategyId}`,
        { method: "PUT", body: JSON.stringify(config) }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["strategy", "canonical"] }),
  });
}

export function useToggleStrategy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (strategyId: string) =>
      fetchWithAuth<{ success: boolean; isActive: boolean }>(
        `/api/strategy/${strategyId}/toggle`,
        { method: "POST" }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["strategy", "canonical"] }),
  });
}

export function useScanStrategy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (execute: boolean) =>
      fetchWithAuth<{
        scanned: boolean;
        riskState?: { mode: StrategyRiskMode };
        signals: Array<{
          id: string;
          module: string;
          symbol: string;
          executed: boolean;
          executionReason?: string;
        }>;
        reason?: string;
      }>("/api/strategy/scan", {
        method: "POST",
        body: JSON.stringify({ execute }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["strategy"] });
      client.invalidateQueries({ queryKey: ["signals"] });
      client.invalidateQueries({ queryKey: ["auto-trading"] });
    },
  });
}

function runtimeMutation(endpoint: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; strategy: Strategy }>(endpoint, {
        method: "POST",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["strategy", "canonical"] });
      client.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

export function useResetStrategyRuntime() {
  return runtimeMutation("/api/strategy/runtime/reset");
}

export function useStartForwardValidation() {
  return runtimeMutation("/api/strategy/validation/start");
}
