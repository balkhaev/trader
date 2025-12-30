"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface NotificationSettings {
  telegramChatId: string | null;
  telegramEnabled: boolean;
  emailEnabled: boolean;
  notifyNewSignals: boolean;
  notifyTradeOpened: boolean;
  notifyTradeClosed: boolean;
  notifyTrendAlerts: boolean;
  notifyTransportSignals: boolean;
  minSignalStrength: string;
}

export interface TelegramStatus {
  serverConfigured: boolean;
  userChatId: string | null;
  enabled: boolean;
  ready: boolean;
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

export function useNotificationSettings() {
  return useQuery({
    queryKey: ["notifications", "settings"],
    queryFn: () =>
      fetchWithAuth<NotificationSettings>("/api/notifications/settings"),
  });
}

export function useUpdateNotificationSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Partial<NotificationSettings>) =>
      fetchWithAuth<{ success: boolean; settings: NotificationSettings }>(
        "/api/notifications/settings",
        {
          method: "PUT",
          body: JSON.stringify(settings),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useTelegramStatus() {
  return useQuery({
    queryKey: ["notifications", "telegram-status"],
    queryFn: () =>
      fetchWithAuth<TelegramStatus>("/api/notifications/telegram-status"),
  });
}

export function useTestTelegramNotification() {
  return useMutation({
    mutationFn: () =>
      fetchWithAuth<{ success: boolean; message?: string }>(
        "/api/notifications/test-telegram",
        {
          method: "POST",
        }
      ),
  });
}
