"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Condition types
export interface IndicatorCondition {
  type: "indicator";
  indicator: "rsi" | "macd" | "bollinger" | "sma" | "ema" | "adx" | "atr";
  parameter: string;
  period?: number;
  operator: ">" | "<" | ">=" | "<=" | "==" | "crosses_above" | "crosses_below";
  value: number | string;
}

export interface PriceCondition {
  type: "price";
  comparison: "close" | "open" | "high" | "low" | "volume";
  operator: ">" | "<" | ">=" | "<=" | "==";
  value: number | string;
}

export interface NewsCondition {
  type: "news";
  sentimentMin?: number;
  sentimentMax?: number;
  keywords?: string[];
  sources?: string[];
}

export interface TransportCondition {
  type: "transport";
  commodity: string;
  signalDirection?: "bullish" | "bearish";
  minStrength?: number;
}

export type StrategyCondition =
  | IndicatorCondition
  | PriceCondition
  | NewsCondition
  | TransportCondition;

export interface StrategyRule {
  id: string;
  name: string;
  conditions: StrategyCondition[];
  conditionLogic: "AND" | "OR";
  action: "long" | "short" | "close_long" | "close_short" | "close_all";
  priority: number;
}

export interface StrategyConfig {
  name: string;
  description?: string;
  symbols: string[];
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  entryRules: StrategyRule[];
  exitRules: StrategyRule[];
  positionSizePercent: number;
  maxPositions: number;
  defaultStopLossPercent?: number;
  defaultTakeProfitPercent?: number;
  trailingStopPercent?: number;
  tradingHoursStart?: string;
  tradingHoursEnd?: string;
  tradingDays?: number[];
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
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
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

export function usePublicStrategies() {
  return useQuery({
    queryKey: ["strategies", "public"],
    queryFn: () =>
      fetchWithAuth<{ strategies: Strategy[] }>("/api/strategy/public"),
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

export function useCreateStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: StrategyConfig) =>
      fetchWithAuth<{ success: boolean; strategy: Strategy }>("/api/strategy", {
        method: "POST",
        body: JSON.stringify(config),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
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
        {
          method: "PUT",
          body: JSON.stringify(config),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
}

export function useDeleteStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (strategyId: string) =>
      fetchWithAuth<{ success: boolean }>(`/api/strategy/${strategyId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
}

export function useToggleStrategy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (strategyId: string) =>
      fetchWithAuth<{ success: boolean; isActive: boolean }>(
        `/api/strategy/${strategyId}/toggle`,
        {
          method: "POST",
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
}

export function useGenerateCode() {
  return useMutation({
    mutationFn: (config: StrategyConfig) =>
      fetchWithAuth<{ code: string; language: string }>(
        "/api/strategy/generate-code",
        {
          method: "POST",
          body: JSON.stringify(config),
        }
      ),
  });
}
