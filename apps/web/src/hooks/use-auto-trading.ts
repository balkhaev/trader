"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface AutoTradingConfig {
  id?: string;
  enabled: boolean;
  exchangeAccountId: string | null;
  minSignalStrength: string;
  allowedSources: string[];
  allowedSymbols: string[] | null;
  blockedSymbols: string[] | null;
  allowLong: boolean;
  allowShort: boolean;
  positionSizeType: "fixed" | "percent" | "risk_based";
  positionSizeValue: string;
  maxPositionSize: string;
  defaultStopLossPercent: string;
  defaultTakeProfitPercent: string;
  maxDailyTrades: string;
  maxOpenPositions: string;
  maxDailyLossPercent: string;
  orderType: "market" | "limit";
  useStopLoss: boolean;
  useTakeProfit: boolean;
}

export interface AutoTradingLog {
  id: string;
  signalId: string | null;
  action: "executed" | "skipped" | "error";
  reason: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AutoTradingStats {
  todayExecuted: number;
  todaySkipped: number;
  todayErrors: number;
  totalToday: number;
  enabled: boolean;
  maxDailyTrades: string;
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

export function useAutoTradingConfig() {
  return useQuery({
    queryKey: ["auto-trading", "config"],
    queryFn: () => fetchWithAuth<AutoTradingConfig>("/api/auto-trading/config"),
  });
}

export function useUpdateAutoTradingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: Partial<AutoTradingConfig>) =>
      fetchWithAuth<{ success: boolean; config: AutoTradingConfig }>(
        "/api/auto-trading/config",
        {
          method: "PUT",
          body: JSON.stringify(config),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-trading"] });
    },
  });
}

export function useToggleAutoTrading() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; enabled: boolean }>(
        "/api/auto-trading/toggle",
        {
          method: "POST",
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-trading"] });
    },
  });
}

export function useAutoTradingLogs(limit = 50) {
  return useQuery({
    queryKey: ["auto-trading", "logs", limit],
    queryFn: () =>
      fetchWithAuth<{ logs: AutoTradingLog[] }>(
        `/api/auto-trading/logs?limit=${limit}`
      ),
    refetchInterval: 30_000,
  });
}

export function useAutoTradingStats() {
  return useQuery({
    queryKey: ["auto-trading", "stats"],
    queryFn: () => fetchWithAuth<AutoTradingStats>("/api/auto-trading/stats"),
    refetchInterval: 30_000,
  });
}
