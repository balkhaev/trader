"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// === POLYMARKET CONTEXT TYPES ===

export interface PolymarketEventContext {
  title: string;
  probability: number;
  change24h: number;
}

export interface PolymarketValidation {
  isAligned: boolean;
  divergenceLevel: "none" | "minor" | "significant" | "major";
  divergenceExplanation?: string;
}

export interface ConfidenceAdjustment {
  originalConfidence: number;
  adjustedConfidence: number;
  adjustmentReason: string;
}

export interface SmartMoneySignal {
  sentiment: "bullish" | "bearish" | "neutral";
  reasoning: string;
}

export interface PolymarketContextInSignal {
  events: PolymarketEventContext[];
  alignment: number;
  validation: PolymarketValidation;
}

export interface SignalMetadata {
  reasoning?: string;
  rejectionReason?: string;
  executionOrder?: unknown;
  // Polymarket enhanced fields
  polymarketContext?: PolymarketContextInSignal;
  originalStrength?: number;
  confidenceAdjustment?: ConfidenceAdjustment;
  smartMoneySignal?: SmartMoneySignal;
}

export interface Signal {
  id: string;
  userId: string;
  source: string;
  symbol: string;
  side: "long" | "short";
  strength: string;
  status: "pending" | "executed" | "rejected" | "expired";
  metadata: SignalMetadata | null;
  createdAt: string;
  executedAt?: string;
  // Performance tracking fields
  entryPrice?: string | null;
  exitPrice?: string | null;
  exitAt?: string | null;
  realizedPnl?: string | null;
  holdingPeriodMinutes?: string | null;
  isWin?: boolean | null;
}

export interface PerformanceStats {
  totalClosed: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgReturn: number;
  totalReturn: number;
  bestTrade: {
    id: string;
    symbol: string;
    side: string;
    pnl: number;
  } | null;
  worstTrade: {
    id: string;
    symbol: string;
    side: string;
    pnl: number;
  } | null;
  avgHoldingPeriodMinutes: number;
  sharpeRatio: number | null;
}

export interface NewsAnalysis {
  id: string;
  sentiment: string;
  sentimentScore: string;
  impactScore: string;
  relevanceScore: string;
  keyPoints: string[];
  marketImplications: string;
  recommendation: {
    action: string;
    symbols: string[];
    reasoning: string;
    confidence: number;
    risks: string[];
  };
}

export interface SignalWithAnalyses extends Signal {
  analyses: NewsAnalysis[];
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

export function useSignals(params?: {
  status?: Signal["status"];
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.limit) searchParams.set("limit", params.limit.toString());

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["signals", params],
    queryFn: () =>
      fetchWithAuth<Signal[]>(`/api/signals${query ? `?${query}` : ""}`),
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
    enabled: !!signalId,
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

export function useApproveSignal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      signalId: string;
      exchangeAccountId: string;
      quantity: string;
      orderType: "market" | "limit";
      price?: string;
      stopLoss?: string;
      takeProfit?: string;
    }) =>
      fetchWithAuth(`/api/signals/${params.signalId}/approve`, {
        method: "POST",
        body: JSON.stringify({
          exchangeAccountId: params.exchangeAccountId,
          quantity: params.quantity,
          orderType: params.orderType,
          price: params.price,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}

export function useRejectSignal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { signalId: string; reason?: string }) =>
      fetchWithAuth(`/api/signals/${params.signalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: params.reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

// === PERFORMANCE TRACKING ===

export function usePerformanceStats() {
  return useQuery({
    queryKey: ["signals", "performance"],
    queryFn: () => fetchWithAuth<PerformanceStats>("/api/signals/performance"),
  });
}

export function useClosedSignals(params?: { limit?: number; offset?: number }) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["signals", "closed", params],
    queryFn: () =>
      fetchWithAuth<Signal[]>(`/api/signals/closed${query ? `?${query}` : ""}`),
  });
}

export function useCloseSignal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { signalId: string; exitPrice: string }) =>
      fetchWithAuth<{ success: boolean; signal: Signal }>(
        `/api/signals/${params.signalId}/close`,
        {
          method: "POST",
          body: JSON.stringify({ exitPrice: params.exitPrice }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}

export function useUpdateEntryPrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { signalId: string; entryPrice: string }) =>
      fetchWithAuth<{ success: boolean; signal: Signal }>(
        `/api/signals/${params.signalId}/entry-price`,
        {
          method: "PATCH",
          body: JSON.stringify({ entryPrice: params.entryPrice }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["signals"] });
    },
  });
}
