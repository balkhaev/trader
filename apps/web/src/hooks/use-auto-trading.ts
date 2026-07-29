"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface AutoTradingConfig {
  id?: string;
  enabled: boolean;
  exchangeAccountId: string | null;
  maxPositionSize: string;
  maxDailyTrades: string;
  maxOpenPositions: string;
  orderType: "market";
}

export interface AutoTradingLog {
  id: string;
  signalId: string | null;
  action: "executed" | "closed" | "skipped" | "error";
  reason: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface AutoTradingStats {
  todayExecuted: number;
  todayClosed: number;
  todaySkipped: number;
  todayErrors: number;
  totalToday: number;
  enabled: boolean;
  maxDailyTrades: string;
}

export interface ExecutionPreflight {
  ready: boolean;
  checks: {
    config: boolean;
    account: boolean;
    venue: boolean;
    liveAllowed: boolean;
    canTrade: boolean;
    oneWayMode: boolean;
    positionsSafe: boolean;
    strategyActive: boolean;
    riskState: boolean;
  };
  reasons: string[];
  account?: { id: string; name: string; testnet: boolean };
  equity?: number;
  positions?: number;
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

export function useAutoTradingConfig() {
  return useQuery({
    queryKey: ["auto-trading", "config"],
    queryFn: () => fetchWithAuth<AutoTradingConfig>("/api/auto-trading/config"),
  });
}

export function useExecutionPreflight() {
  return useQuery({
    queryKey: ["auto-trading", "preflight"],
    queryFn: () =>
      fetchWithAuth<ExecutionPreflight>("/api/auto-trading/preflight"),
    refetchInterval: 30_000,
  });
}

export function useUpdateAutoTradingConfig() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      config: Partial<
        Pick<
          AutoTradingConfig,
          | "exchangeAccountId"
          | "maxPositionSize"
          | "maxDailyTrades"
          | "maxOpenPositions"
        >
      >
    ) =>
      fetchWithAuth<{ success: boolean; config: AutoTradingConfig }>(
        "/api/auto-trading/config",
        { method: "PUT", body: JSON.stringify(config) }
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["auto-trading"] }),
  });
}

export function useToggleAutoTrading() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; enabled: boolean }>(
        "/api/auto-trading/toggle",
        { method: "POST" }
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ["auto-trading"] }),
  });
}

export function useEmergencyStop() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; closed: number }>(
        "/api/auto-trading/emergency-stop",
        { method: "POST" }
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["auto-trading"] });
      client.invalidateQueries({ queryKey: ["exchange"] });
      client.invalidateQueries({ queryKey: ["signals"] });
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
