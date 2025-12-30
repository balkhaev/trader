"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface NewsSource {
  id: string;
  name: string;
  type: "rss" | "api" | "twitter" | "telegram" | "web_scraper";
  url: string;
  category: string;
  enabled: boolean;
  fetchInterval: string;
  lastFetchedAt: string | null;
  createdAt: string;
  config?: {
    newsListSelector?: string;
    articleLinkSelector?: string;
    titleSelector?: string;
    contentSelector?: string;
    watchInterval?: number;
    channelUsername?: string;
  };
}

export interface NewsArticle {
  id: string;
  sourceId: string;
  url: string;
  title: string;
  content: string | null;
  summary: string | null;
  author: string | null;
  imageUrl: string | null;
  category: string | null;
  tags: string[] | null;
  symbols: string[] | null;
  publishedAt: string;
  fetchedAt: string;
}

export interface NewsAnalysis {
  id: string;
  articleId: string;
  status: "pending" | "processing" | "completed" | "failed";
  sentiment: string | null;
  sentimentScore: string | null;
  impactScore: string | null;
  relevanceScore: string | null;
  keyPoints: string[] | null;
  marketImplications: string | null;
  recommendation: {
    action: string;
    symbols: string[];
    reasoning: string;
    confidence: number;
    risks: string[];
  } | null;
  model: string | null;
  error: string | null;
  analyzedAt: string | null;
  createdAt: string;
}

export interface ArticleWithAnalyses extends NewsArticle {
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

export function useNewsArticles(params?: {
  limit?: number;
  offset?: number;
  category?: string;
  symbols?: string[];
  hoursAgo?: number;
  sourceId?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", params.limit.toString());
  if (params?.offset) searchParams.set("offset", params.offset.toString());
  if (params?.category) searchParams.set("category", params.category);
  if (params?.symbols?.length)
    searchParams.set("symbols", params.symbols.join(","));
  if (params?.hoursAgo)
    searchParams.set("hoursAgo", params.hoursAgo.toString());
  if (params?.sourceId) searchParams.set("sourceId", params.sourceId);

  const query = searchParams.toString();
  return useQuery({
    queryKey: ["news", "articles", params],
    queryFn: () =>
      fetchWithAuth<NewsArticle[]>(
        `/api/news/articles${query ? `?${query}` : ""}`
      ),
  });
}

export function useNewsArticle(articleId: string | null) {
  return useQuery({
    queryKey: ["news", "articles", articleId],
    queryFn: () =>
      fetchWithAuth<ArticleWithAnalyses>(`/api/news/articles/${articleId}`),
    enabled: !!articleId,
  });
}

export function useNewsSources() {
  return useQuery({
    queryKey: ["news", "sources"],
    queryFn: () => fetchWithAuth<NewsSource[]>("/api/news/sources"),
  });
}

export function useNewsStats() {
  return useQuery({
    queryKey: ["news", "stats"],
    queryFn: () =>
      fetchWithAuth<{
        totalSources: number;
        totalArticles: number;
        totalAnalyses: number;
        articlesLast24h: number;
      }>("/api/news/stats"),
  });
}

export function useCreateNewsSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      name: string;
      type: "rss" | "api" | "twitter" | "telegram" | "web_scraper";
      url: string;
      category?: string;
      fetchInterval?: number;
      config?: NewsSource["config"];
    }) =>
      fetchWithAuth("/api/news/sources", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "sources"] });
    },
  });
}

export function useFetchNewsSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceId: string) =>
      fetchWithAuth(`/api/news/sources/${sourceId}/fetch`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news"] });
    },
  });
}

export function useFetchAllNews() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => fetchWithAuth("/api/news/fetch-all", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news"] });
    },
  });
}

export function useAnalyzeArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (articleId: string) =>
      fetchWithAuth<NewsAnalysis>(`/api/news/articles/${articleId}/analyze`, {
        method: "POST",
      }),
    onSuccess: (_, articleId) => {
      queryClient.invalidateQueries({
        queryKey: ["news", "articles", articleId],
      });
    },
  });
}

export function useUpdateNewsSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{
        name: string;
        url: string;
        enabled: boolean;
        config: NewsSource["config"];
      }>;
    }) =>
      fetchWithAuth<NewsSource>(`/api/news/sources/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "sources"] });
    },
  });
}

export function useDeleteNewsSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sourceId: string) =>
      fetchWithAuth(`/api/news/sources/${sourceId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "sources"] });
      queryClient.invalidateQueries({ queryKey: ["news", "stats"] });
    },
  });
}

export function useSyncPresets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ added: string[]; updated: string[] }>(
        "/api/news/presets/sync",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "sources"] });
      queryClient.invalidateQueries({ queryKey: ["news", "stats"] });
    },
  });
}
