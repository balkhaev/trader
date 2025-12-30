"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface PolymarketEvent {
  id: string;
  ticker: string | null;
  slug: string;
  title: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  image: string | null;
  active: boolean;
  closed: boolean;
  liquidity: number | null;
  volume: number | null;
  volume24hr: number | null;
  openInterest: number | null;
  tags: { id: string; slug: string; label: string }[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolymarketMarket {
  id: string;
  eventId: string;
  question: string;
  slug: string | null;
  description: string | null;
  outcomes: string[] | null;
  outcomePrices: string[] | null;
  volume: number | null;
  volume24hr: number | null;
  liquidity: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  lastTradePrice: number | null;
  spread: number | null;
  active: boolean;
  closed: boolean;
  conditionId: string | null;
  clobTokenIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolymarketEventWithMarkets extends PolymarketEvent {
  markets: PolymarketMarket[];
}

interface UsePolymarketEventsParams {
  limit?: number;
  offset?: number;
  active?: boolean;
  closed?: boolean;
  tag?: string;
  search?: string;
  minVolume?: number;
}

interface UsePolymarketResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePolymarketFinance(
  params: { limit?: number; offset?: number } = {}
): UsePolymarketResult<PolymarketEvent[]> {
  const [data, setData] = useState<PolymarketEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const searchParams = new URLSearchParams();
      if (params.limit) {
        searchParams.set("limit", String(params.limit));
      }
      if (params.offset) {
        searchParams.set("offset", String(params.offset));
      }

      const response = await fetch(
        `${API_URL}/api/polymarket/finance?${searchParams}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params.limit, params.offset]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function usePolymarketEvents(
  params: UsePolymarketEventsParams = {}
): UsePolymarketResult<PolymarketEvent[]> {
  const [data, setData] = useState<PolymarketEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const searchParams = new URLSearchParams();
      if (params.limit) {
        searchParams.set("limit", String(params.limit));
      }
      if (params.offset) {
        searchParams.set("offset", String(params.offset));
      }
      if (params.active !== undefined) {
        searchParams.set("active", String(params.active));
      }
      if (params.closed !== undefined) {
        searchParams.set("closed", String(params.closed));
      }
      if (params.tag) {
        searchParams.set("tag", params.tag);
      }
      if (params.search) {
        searchParams.set("search", params.search);
      }
      if (params.minVolume) {
        searchParams.set("minVolume", String(params.minVolume));
      }

      const response = await fetch(
        `${API_URL}/api/polymarket/events?${searchParams}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [
    params.limit,
    params.offset,
    params.active,
    params.closed,
    params.tag,
    params.search,
    params.minVolume,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function usePolymarketEvent(
  eventId: string | null
): UsePolymarketResult<PolymarketEventWithMarkets> {
  const [data, setData] = useState<PolymarketEventWithMarkets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!eventId) {
      setData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/api/polymarket/events/${eventId}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export interface PolymarketStats {
  totalEvents: number;
  totalMarkets: number;
  activeEvents: number;
  totalVolume: number;
}

export function usePolymarketStats(): UsePolymarketResult<PolymarketStats> {
  const [data, setData] = useState<PolymarketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/polymarket/stats`);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export interface MarketOpportunity extends PolymarketMarket {
  event: {
    id: string;
    title: string;
    slug: string;
    image: string | null;
    tags: { id: string; slug: string; label: string }[] | null;
  };
}

export function usePolymarketOpportunities(
  params: { limit?: number } = {}
): UsePolymarketResult<MarketOpportunity[]> {
  const [data, setData] = useState<MarketOpportunity[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const searchParams = new URLSearchParams();
      if (params.limit) {
        searchParams.set("limit", String(params.limit));
      }

      const response = await fetch(
        `${API_URL}/api/polymarket/opportunities?${searchParams}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params.limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function usePolymarketTrending(
  params: { limit?: number } = {}
): UsePolymarketResult<PolymarketEvent[]> {
  const [data, setData] = useState<PolymarketEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const searchParams = new URLSearchParams();
      if (params.limit) {
        searchParams.set("limit", String(params.limit));
      }

      const response = await fetch(
        `${API_URL}/api/polymarket/trending?${searchParams}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [params.limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function formatVolume(volume: number | null): string {
  if (volume === null) {
    return "-";
  }
  if (volume >= 1_000_000) {
    return `$${(volume / 1_000_000).toFixed(1)}M`;
  }
  if (volume >= 1000) {
    return `$${(volume / 1000).toFixed(1)}K`;
  }
  return `$${volume.toFixed(0)}`;
}

export function formatProbability(prices: string[] | null): number | null {
  if (!prices || prices.length === 0) {
    return null;
  }
  const yesPrice = Number.parseFloat(prices[0] || "0");
  return Math.round(yesPrice * 100);
}

// === MARKET INTELLIGENCE TYPES ===

export interface SmartMoneySignal {
  question: string;
  sentiment: "bullish" | "bearish" | "neutral";
  confidence: number;
  topHoldersBias: number;
}

export interface MarketIntelligence {
  overallAlignment: number;
  sentimentDistribution: {
    bullish: number;
    bearish: number;
    neutral: number;
  };
  avgProbabilityChange: number;
  topCorrelatedEvent: {
    question: string;
    probability: number;
    change24h: number;
  } | null;
  stats: {
    totalEvents: number;
    totalMarkets: number;
    activeMarkets: number;
  };
  smartMoneySignals: SmartMoneySignal[];
}

export function useMarketIntelligence(): UsePolymarketResult<MarketIntelligence> {
  const [data, setData] = useState<MarketIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/api/polymarket/intelligence`);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// === POLYMARKET CONTEXT FOR SYMBOL ===

export interface PolymarketEventForContext {
  id: string;
  title: string;
  probability: number;
  probabilityChange24h: number;
  volume: number;
  relevance: number;
}

export interface PolymarketContext {
  symbol: string;
  events: PolymarketEventForContext[];
  marketSentiment: "bullish" | "bearish" | "neutral";
  smartMoney: {
    sentiment: "bullish" | "bearish" | "neutral";
    confidence: number;
    topHoldersBias: number;
  };
  summary: {
    totalEvents: number;
    avgProbability: number;
    avgProbabilityChange: number;
  };
}

export function usePolymarketContext(
  symbol: string | null
): UsePolymarketResult<PolymarketContext> {
  const [data, setData] = useState<PolymarketContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!symbol) {
      setData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/api/polymarket/context/${encodeURIComponent(symbol)}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// === PROBABILITY SNAPSHOTS ===

export interface ProbabilitySnapshots {
  marketId: string;
  hours: number;
  current: number;
  oldest: number;
  change24h: number;
  snapshots: Array<{
    probability: number;
    timestamp: string;
  }>;
}

export function useProbabilitySnapshots(
  marketId: string | null,
  hours = 24
): UsePolymarketResult<ProbabilitySnapshots> {
  const [data, setData] = useState<ProbabilitySnapshots | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!marketId) {
      setData(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/api/polymarket/markets/${marketId}/snapshots?hours=${hours}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [marketId, hours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// === HELPER FUNCTIONS ===

export function formatProbabilityChange(change: number): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${(change * 100).toFixed(1)}%`;
}

export function getAlignmentColor(alignment: number): string {
  if (alignment >= 0.5) return "text-green-500";
  if (alignment >= 0) return "text-yellow-500";
  return "text-red-500";
}

export function getAlignmentLabel(alignment: number): string {
  if (alignment >= 0.7) return "Strong Alignment";
  if (alignment >= 0.3) return "Moderate Alignment";
  if (alignment >= -0.3) return "Neutral";
  if (alignment >= -0.7) return "Moderate Divergence";
  return "Strong Divergence";
}

export function getSentimentColor(
  sentiment: "bullish" | "bearish" | "neutral"
): string {
  switch (sentiment) {
    case "bullish":
      return "text-green-500";
    case "bearish":
      return "text-red-500";
    default:
      return "text-gray-500";
  }
}

export function getDivergenceBadgeVariant(
  level: "none" | "minor" | "significant" | "major"
): "default" | "secondary" | "destructive" | "outline" {
  switch (level) {
    case "major":
      return "destructive";
    case "significant":
      return "secondary";
    default:
      return "outline";
  }
}
