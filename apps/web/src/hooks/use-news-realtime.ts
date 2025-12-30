"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NewsArticle } from "./use-news";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const WS_URL = API_URL.replace("http", "ws");

// Типы WebSocket событий
interface WsNewsArticleEvent {
  type: "news:article";
  data: {
    article: NewsArticle;
    source: {
      id: string;
      name: string;
      type: string;
    };
  };
}

interface WsSourceStatusEvent {
  type: "news:source_status";
  data: {
    sourceId: string;
    sourceName: string;
    status: "connected" | "disconnected" | "error";
    error?: string;
  };
}

interface WsStatsEvent {
  type: "news:stats";
  data: {
    connectedClients: number;
    watchingSources: number;
    telegramChannels: number;
  };
}

type WsServerEvent = WsNewsArticleEvent | WsSourceStatusEvent | WsStatsEvent;

export interface RealtimeStatus {
  isRunning: boolean;
  webScraperSources: number;
  telegramChannels: number;
  connectedClients: number;
  errors: Array<{ sourceId: string; error: string; timestamp: string }>;
}

export interface PresetSource {
  key: string;
  name: string;
  type: "web_scraper" | "telegram";
  url: string;
  category: string;
  config: Record<string, unknown>;
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

// Хук для WebSocket подключения
export function useNewsWebSocket(options?: {
  categories?: string[];
  symbols?: string[];
  sourceIds?: string[];
  onArticle?: (
    article: NewsArticle,
    source: { id: string; name: string }
  ) => void;
  onSourceStatus?: (sourceId: string, status: string, error?: string) => void;
  enabled?: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [realtimeArticles, setRealtimeArticles] = useState<NewsArticle[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(`${WS_URL}/api/news/ws`);

      ws.onopen = () => {
        setConnected(true);
        // Отправляем подписку
        ws.send(
          JSON.stringify({
            type: "subscribe:news",
            data: {
              categories: options?.categories,
              symbols: options?.symbols,
              sourceIds: options?.sourceIds,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const message: WsServerEvent = JSON.parse(event.data);

          switch (message.type) {
            case "news:article": {
              const { article, source } = message.data;
              setRealtimeArticles((prev) => [article, ...prev.slice(0, 99)]);
              options?.onArticle?.(article, source);
              // Инвалидируем кэш статей
              queryClient.invalidateQueries({ queryKey: ["news", "articles"] });
              break;
            }
            case "news:source_status": {
              const { sourceId, status, error } = message.data;
              options?.onSourceStatus?.(sourceId, status, error);
              break;
            }
          }
        } catch {
          console.error("[NewsWebSocket] Failed to parse message");
        }
      };

      ws.onclose = () => {
        setConnected(false);
        // Переподключение через 3 секунды
        reconnectTimeoutRef.current = setTimeout(() => {
          if (options?.enabled !== false) {
            connect();
          }
        }, 3000);
      };

      ws.onerror = () => {
        setConnected(false);
      };

      wsRef.current = ws;
    } catch (error) {
      console.error("[NewsWebSocket] Connection error:", error);
    }
  }, [options, queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (options?.enabled !== false) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [options?.enabled, connect, disconnect]);

  return {
    connected,
    realtimeArticles,
    clearArticles: () => setRealtimeArticles([]),
  };
}

// Хук для получения статуса realtime
export function useRealtimeStatus() {
  return useQuery({
    queryKey: ["news", "realtime", "status"],
    queryFn: () => fetchWithAuth<RealtimeStatus>("/api/news/realtime/status"),
    refetchInterval: 5000, // Обновляем каждые 5 секунд
  });
}

// Хук для запуска/остановки realtime
export function useRealtimeControl() {
  const queryClient = useQueryClient();

  const startRealtime = useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; status: RealtimeStatus }>(
        "/api/news/realtime/start",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "realtime"] });
    },
  });

  const stopRealtime = useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; status: RealtimeStatus }>(
        "/api/news/realtime/stop",
        { method: "POST" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "realtime"] });
    },
  });

  return { startRealtime, stopRealtime };
}

// Хук для управления отдельными источниками realtime
export function useSourceRealtimeControl() {
  const queryClient = useQueryClient();

  const startSource = useMutation({
    mutationFn: (sourceId: string) =>
      fetchWithAuth(`/api/news/realtime/sources/${sourceId}/start`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "realtime"] });
    },
  });

  const stopSource = useMutation({
    mutationFn: (sourceId: string) =>
      fetchWithAuth(`/api/news/realtime/sources/${sourceId}/stop`, {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "realtime"] });
    },
  });

  return { startSource, stopSource };
}

// Хук для preset источников
export function usePresetSources() {
  return useQuery({
    queryKey: ["news", "presets"],
    queryFn: () => fetchWithAuth<PresetSource[]>("/api/news/presets"),
  });
}

export function useAddPresetSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (key: string) =>
      fetchWithAuth(`/api/news/presets/${key}/add`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news", "sources"] });
    },
  });
}
