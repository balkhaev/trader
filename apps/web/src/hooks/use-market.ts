"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Types
export interface MarketAsset {
  id: string;
  symbol: string;
  name: string;
  marketType: "crypto" | "etf" | "stock" | "moex" | "forex" | "commodity";
  dataSource: "binance" | "bybit" | "yahoo" | "alpaca" | "moex_iss" | "tinkoff";
  baseCurrency: string | null;
  quoteCurrency: string | null;
  sector: string | null;
  isActive: string;
  createdAt: string;
  updatedAt: string;
}

export interface MarketCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketIndicator {
  id: string;
  assetId: string;
  timeframe: string;
  indicatorType: string;
  timestamp: string;
  value: string | null;
  values: Record<string, unknown> | null;
  params: Record<string, unknown> | null;
}

export interface MarketTrend {
  id: string;
  assetId: string;
  timeframe: string;
  trendType: string;
  strength: string;
  confidence: string;
  startPrice: string;
  currentPrice: string;
  priceChange: string | null;
  startDate: string;
  endDate: string | null;
  isActive: string;
  metadata: {
    supportLevel?: number;
    resistanceLevel?: number;
    volumeConfirmation?: boolean;
    indicatorSignals?: {
      rsi?: string;
      macd?: string;
      adx?: number;
    };
  } | null;
}

export interface MarketOpportunity {
  id: string;
  assetId: string;
  type: string;
  direction: "long" | "short";
  score: string;
  entryPrice: string | null;
  targetPrice: string | null;
  stopLoss: string | null;
  riskRewardRatio: string | null;
  timeframe: string;
  reasoning: string;
  indicators: {
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    adx?: number;
    volumeChange?: number;
    priceChange24h?: number;
  } | null;
  isActive: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface MarketOverview {
  summary: {
    totalAssets: number;
    byMarket: Record<string, number>;
    activeTrends: number;
    activeOpportunities: number;
  };
  topOpportunities: Array<MarketOpportunity & { asset: MarketAsset }>;
  recentTrends: Array<MarketTrend & { asset: MarketAsset }>;
  scheduler: {
    isRunning: boolean;
    lastRun: Record<string, string>;
    nextRun: Record<string, string>;
  };
  lastUpdated: string;
}

export interface TechnicalAnalysis {
  symbol: string;
  timeframe: string;
  timestamp: string;
  rsi?: { value: number; signal: string };
  macd?: { macd: number; signal: number; histogram: number; trend: string };
  bollinger?: {
    upper: number;
    middle: number;
    lower: number;
    percentB: number;
    bandwidth: number;
  };
  adx?: { adx: number; plusDI: number; minusDI: number; trendStrength: string };
  atr?: { value: number; volatilityLevel: string };
  trend?: {
    type: string;
    strength: string;
    confidence: number;
    startDate: string;
    priceChange: number;
    volumeConfirmation: boolean;
  };
}

export interface HeatmapItem {
  symbol: string;
  sector: string;
  priceChange: number;
  volume: number;
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

// ===== Hooks =====

export function useMarketOverview() {
  return useQuery({
    queryKey: ["market", "overview"],
    queryFn: () => fetchWithAuth<MarketOverview>("/api/market/overview"),
    refetchInterval: 60_000, // Refresh every minute
  });
}

export function useMarketAssets(params?: {
  marketType?: string;
  sector?: string;
  limit?: number;
  offset?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.marketType) searchParams.set("marketType", params.marketType);
  if (params?.sector) searchParams.set("sector", params.sector);
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["market", "assets", params],
    queryFn: () =>
      fetchWithAuth<{
        assets: MarketAsset[];
        total: number;
        limit: number;
        offset: number;
      }>(`/api/market/assets${query ? `?${query}` : ""}`),
  });
}

export function useMarketAsset(symbol: string | null) {
  return useQuery({
    queryKey: ["market", "asset", symbol],
    queryFn: () =>
      fetchWithAuth<{
        asset: MarketAsset;
        indicators: MarketIndicator[];
        trend: MarketTrend | null;
        opportunity: MarketOpportunity | null;
      }>(`/api/market/assets/${symbol}`),
    enabled: !!symbol,
  });
}

export function useMarketCandles(
  symbol: string | null,
  params?: {
    timeframe?: string;
    limit?: number;
    startTime?: string;
    endTime?: string;
  }
) {
  const searchParams = new URLSearchParams();
  if (params?.timeframe) searchParams.set("timeframe", params.timeframe);
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.startTime) searchParams.set("startTime", params.startTime);
  if (params?.endTime) searchParams.set("endTime", params.endTime);

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["market", "candles", symbol, params],
    queryFn: () =>
      fetchWithAuth<{
        symbol: string;
        timeframe: string;
        candles: MarketCandle[];
      }>(`/api/market/candles/${symbol}${query ? `?${query}` : ""}`),
    enabled: !!symbol,
  });
}

export function useMarketIndicators(
  symbol: string | null,
  params?: {
    timeframe?: string;
    types?: string;
  }
) {
  const searchParams = new URLSearchParams();
  if (params?.timeframe) searchParams.set("timeframe", params.timeframe);
  if (params?.types) searchParams.set("types", params.types);

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["market", "indicators", symbol, params],
    queryFn: () =>
      fetchWithAuth<{
        symbol: string;
        timeframe: string;
        indicators: MarketIndicator[];
      }>(`/api/market/indicators/${symbol}${query ? `?${query}` : ""}`),
    enabled: !!symbol,
  });
}

export function useMarketTrends(params?: {
  marketType?: string;
  trendType?: string;
  strength?: string;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.marketType) searchParams.set("marketType", params.marketType);
  if (params?.trendType) searchParams.set("trendType", params.trendType);
  if (params?.strength) searchParams.set("strength", params.strength);
  if (params?.limit) searchParams.set("limit", params.limit.toString());

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["market", "trends", params],
    queryFn: () =>
      fetchWithAuth<{ trends: Array<MarketTrend & { asset: MarketAsset }> }>(
        `/api/market/trends${query ? `?${query}` : ""}`
      ),
  });
}

export function useMarketOpportunities(params?: {
  marketType?: string;
  direction?: "long" | "short";
  minScore?: number;
  limit?: number;
}) {
  const searchParams = new URLSearchParams();
  if (params?.marketType) searchParams.set("marketType", params.marketType);
  if (params?.direction) searchParams.set("direction", params.direction);
  if (params?.minScore)
    searchParams.set("minScore", params.minScore.toString());
  if (params?.limit) searchParams.set("limit", params.limit.toString());

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["market", "opportunities", params],
    queryFn: () =>
      fetchWithAuth<{
        opportunities: Array<MarketOpportunity & { asset: MarketAsset }>;
      }>(`/api/market/opportunities${query ? `?${query}` : ""}`),
  });
}

export function useMarketHeatmap() {
  return useQuery({
    queryKey: ["market", "heatmap"],
    queryFn: () =>
      fetchWithAuth<{
        data: HeatmapItem[];
        bySector: Record<string, HeatmapItem[]>;
      }>("/api/market/heatmap"),
    refetchInterval: 300_000, // Refresh every 5 minutes
  });
}

export function useAnalyzeSymbol() {
  return useMutation({
    mutationFn: (data: { symbol: string; timeframe?: string }) =>
      fetchWithAuth<{
        symbol: string;
        timeframe: string;
        currentPrice: number;
        change24h: {
          priceChange: number;
          priceChangePercent: number;
          volume: number;
        };
        analysis: TechnicalAnalysis;
      }>("/api/market/analyze", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  });
}

export function useCollectMarketData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      timeframe?: string;
      topCount?: number;
      limit?: number;
    }) =>
      fetchWithAuth<{
        message: string;
        totalAssets: number;
        totalCandles: number;
      }>("/api/market/collect", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market"] });
    },
  });
}

export function useSchedulerControl() {
  const queryClient = useQueryClient();

  return {
    start: useMutation({
      mutationFn: () =>
        fetchWithAuth<{ message: string; status: MarketOverview["scheduler"] }>(
          "/api/market/scheduler/start",
          { method: "POST" }
        ),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["market", "overview"] });
      },
    }),
    stop: useMutation({
      mutationFn: () =>
        fetchWithAuth<{ message: string; status: MarketOverview["scheduler"] }>(
          "/api/market/scheduler/stop",
          { method: "POST" }
        ),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["market", "overview"] });
      },
    }),
    status: useQuery({
      queryKey: ["market", "scheduler", "status"],
      queryFn: () =>
        fetchWithAuth<MarketOverview["scheduler"]>(
          "/api/market/scheduler/status"
        ),
      refetchInterval: 30_000,
    }),
  };
}

// ===== Data Sources =====

export interface MarketSource {
  id: string;
  name: string;
  description: string;
  marketType: string;
  enabled: boolean;
}

export function useMarketSources() {
  return useQuery({
    queryKey: ["market", "sources"],
    queryFn: () =>
      fetchWithAuth<{ sources: MarketSource[] }>("/api/market/sources"),
  });
}
