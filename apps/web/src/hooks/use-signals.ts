"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface SignalMetadata extends Record<string, unknown> {
  reasoning?: string;
  rejectionReason?: string;
  executionOrder?: unknown;
  strategyKind?: string;
}

export interface Signal {
  id: string;
  userId: string;
  source: string;
  symbol: string;
  side: "long" | "short";
  strength: string | null;
  status: "pending" | "executed" | "rejected" | "expired";
  metadata: SignalMetadata | null;
  createdAt: string;
  executedAt?: string | null;
  entryPrice?: string | null;
  exitPrice?: string | null;
  exitAt?: string | null;
  realizedPnl?: string | null;
  holdingPeriodMinutes?: string | null;
  isWin?: boolean | null;
}

export interface NewsAnalysis {
  id: string;
  sentiment: string;
  keyPoints?: string[];
}

export interface SignalWithAnalyses extends Signal {
  analyses: NewsAnalysis[];
}

export interface PerformanceStats {
  totalClosed: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  bestTrade: { id: string; symbol: string; side: string; pnl: number } | null;
  worstTrade: { id: string; symbol: string; side: string; pnl: number } | null;
  avgHoldingPeriodMinutes: number;
  sharpeRatio: number | null;
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

export function useSignals(params?: {
  status?: Signal["status"];
  limit?: number;
  offset?: number;
}) {
  const search = new URLSearchParams();
  if (params?.status) search.set("status", params.status);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const query = search.toString();
  return useQuery({
    queryKey: ["signals", params],
    queryFn: () =>
      fetchWithAuth<Signal[]>(`/api/signals${query ? `?${query}` : ""}`),
    refetchInterval: 30_000,
  });
}

export function usePendingSignals() {
  return useQuery({
    queryKey: ["signals", "pending"],
    queryFn: () => fetchWithAuth<Signal[]>("/api/signals/pending"),
    refetchInterval: 30_000,
  });
}

export function useSignal(signalId: string | null) {
  return useQuery({
    queryKey: ["signals", signalId],
    queryFn: () =>
      fetchWithAuth<SignalWithAnalyses>(`/api/signals/${signalId}`),
    enabled: Boolean(signalId),
  });
}

export function useSignalStats() {
  return useQuery({
    queryKey: ["signals", "stats"],
    queryFn: () =>
      fetchWithAuth<{
        total: number;
        pending: number;
        executed: number;
        rejected: number;
        expired: number;
        executionRate: number;
      }>("/api/signals/stats"),
  });
}

export function usePerformanceStats() {
  return useQuery({
    queryKey: ["signals", "performance"],
    queryFn: () =>
      fetchWithAuth<PerformanceStats>("/api/signals/performance"),
  });
}

export function useClosedSignals(params?: { limit?: number; offset?: number }) {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const query = search.toString();
  return useQuery({
    queryKey: ["signals", "closed", params],
    queryFn: () =>
      fetchWithAuth<Signal[]>(
        `/api/signals/closed${query ? `?${query}` : ""}`
      ),
    refetchInterval: 30_000,
  });
}

const disabled = (message: string) => {
  throw new Error(message);
};

export function useApproveSignal() {
  return useMutation({
    mutationFn: async (_params: {
      signalId: string;
      exchangeAccountId: string;
      quantity: string;
      orderType: "market" | "limit";
      price?: string;
      stopLoss?: string;
      takeProfit?: string;
    }) => disabled("Manual approval is disabled; use Consensus Execution"),
  });
}

export function useRejectSignal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (_params: { signalId: string; reason?: string }) =>
      disabled("Manual rejection is disabled for deterministic signals"),
    onSuccess: () => client.invalidateQueries({ queryKey: ["signals"] }),
  });
}

export function useCloseSignal() {
  return useMutation({
    mutationFn: async (_params: { signalId: string; exitPrice: string }) =>
      disabled("Use Emergency Stop or the strategy time exit"),
  });
}

export function useUpdateEntryPrice() {
  return useMutation({
    mutationFn: async (_params: { signalId: string; entryPrice: string }) =>
      disabled("Entry price is reconciled from Binance execution"),
  });
}
