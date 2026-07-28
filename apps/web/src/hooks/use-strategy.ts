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
    orderType: "market" | "limit";
    roundTurnCostBps: number;
    maxPositions: number;
    maxGrossLeverage: number;
    skipOvernight: boolean;
    skipFundingCrossing: boolean;
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
}

export interface Strategy {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config: StrategyConfig;
  isPublic: boolean;
  isActive: boolean;
  leanCode: string | null;
  lastBacktestId: string | null;
  backtestCount: string;
  createdAt: string;
  updatedAt: string;
}

async function fetchWithAuth<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
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
  return response.json();
}

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: () => fetchWithAuth<{ strategies: Strategy[] }>("/api/strategy"),
  });
}

export function useCanonicalStrategy() {
  return useQuery({
    queryKey: ["strategies", "canonical"],
    queryFn: () => fetchWithAuth<Strategy>("/api/strategy/canonical"),
  });
}

export function useDefaultStrategy() {
  return useQuery({
    queryKey: ["strategies", "default"],
    queryFn: () =>
      fetchWithAuth<{ config: StrategyConfig }>("/api/strategy/default"),
  });
}

export function useStrategy(strategyId: string | null) {
  return useQuery({
    queryKey: ["strategies", strategyId],
    queryFn: () => fetchWithAuth<Strategy>(`/api/strategy/${strategyId}`),
    enabled: !!strategyId,
  });
}

export function useStrategyCode(strategyId: string | null) {
  return useQuery({
    queryKey: ["strategies", strategyId, "code"],
    queryFn: () =>
      fetchWithAuth<{ code: string; name: string; language: string }>(
        `/api/strategy/${strategyId}/code`
      ),
    enabled: !!strategyId,
  });
}

export function useUpdateStrategy() {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });
}

export function useToggleStrategy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (strategyId: string) =>
      fetchWithAuth<{ success: boolean; isActive: boolean }>(
        `/api/strategy/${strategyId}/toggle`,
        { method: "POST" }
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["strategies"] }),
  });
}

export function useScanStrategy() {
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["auto-trading"] });
    },
  });
}

export function useGenerateCode() {
  return useMutation({
    mutationFn: (config: StrategyConfig) =>
      fetchWithAuth<{ code: string; language: string }>(
        "/api/strategy/generate-code",
        { method: "POST", body: JSON.stringify(config) }
      ),
  });
}
