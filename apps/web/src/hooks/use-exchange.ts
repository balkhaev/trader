"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface ExchangeAccount {
  id: string;
  exchange: "bybit" | "binance" | "tinkoff";
  name: string;
  testnet: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface Balance {
  asset: string;
  free: string;
  locked: string;
  total: string;
  usdValue?: string;
}

export interface AccountInfo {
  totalBalance: string;
  availableBalance: string;
  unrealizedPnl: string;
  marginUsed?: string;
}

export interface Position {
  symbol: string;
  side: "long" | "short";
  quantity: string;
  entryPrice: string;
  currentPrice: string;
  unrealizedPnl: string;
  leverage?: number;
  liquidationPrice?: string;
}

export interface OverviewData {
  totalBalance: string;
  totalUnrealizedPnl: string;
  totalPositions: number;
  accountsCount: number;
  accounts: Array<{
    accountId: string;
    accountName: string;
    exchange: string;
    testnet: boolean;
    totalBalance: string;
    availableBalance: string;
    unrealizedPnl: string;
    positionsCount: number;
    positions: Position[];
  }>;
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

export function useExchangeAccounts() {
  return useQuery({
    queryKey: ["exchange", "accounts"],
    queryFn: () => fetchWithAuth<ExchangeAccount[]>("/api/exchange/accounts"),
  });
}

export function useExchangeOverview() {
  return useQuery({
    queryKey: ["exchange", "overview"],
    queryFn: () => fetchWithAuth<OverviewData>("/api/exchange/overview"),
    refetchInterval: 30_000, // Обновляем каждые 30 секунд
  });
}

export function useAccountBalance(accountId: string | null) {
  return useQuery({
    queryKey: ["exchange", "balance", accountId],
    queryFn: () =>
      fetchWithAuth<{ accountInfo: AccountInfo; balances: Balance[] }>(
        `/api/exchange/accounts/${accountId}/balance`
      ),
    enabled: !!accountId,
  });
}

export function useAccountPositions(accountId: string | null) {
  return useQuery({
    queryKey: ["exchange", "positions", accountId],
    queryFn: () =>
      fetchWithAuth<Position[]>(
        `/api/exchange/accounts/${accountId}/positions`
      ),
    enabled: !!accountId,
    refetchInterval: 10_000, // Обновляем каждые 10 секунд
  });
}

export function useAddExchangeAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      exchange: "bybit" | "binance" | "tinkoff";
      name: string;
      apiKey: string;
      apiSecret: string;
      testnet: boolean;
    }) =>
      fetchWithAuth<ExchangeAccount>("/api/exchange/accounts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}

export function useDeleteExchangeAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) =>
      fetchWithAuth(`/api/exchange/accounts/${accountId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}

export function useCreateOrder(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      symbol: string;
      side: "buy" | "sell";
      type: "market" | "limit";
      quantity: string;
      price?: string;
      stopLoss?: string;
      takeProfit?: string;
    }) =>
      fetchWithAuth(`/api/exchange/accounts/${accountId}/orders`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}

export interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit";
  status: "pending" | "filled" | "cancelled" | "rejected";
  quantity: string;
  price: string;
  filledQuantity?: string;
  avgPrice?: string;
  createdAt: string;
  updatedAt?: string;
}

export function useOpenOrders(accountId: string | null) {
  return useQuery({
    queryKey: ["exchange", "orders", accountId],
    queryFn: () =>
      fetchWithAuth<Order[]>(`/api/exchange/accounts/${accountId}/orders`),
    enabled: !!accountId,
    refetchInterval: 10_000,
  });
}

export function useCancelOrder(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { orderId: string; symbol: string }) =>
      fetchWithAuth(
        `/api/exchange/accounts/${accountId}/orders/${data.orderId}`,
        {
          method: "DELETE",
          body: JSON.stringify({ symbol: data.symbol }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}

export function useClosePosition(accountId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      symbol: string;
      quantity?: string;
      type?: "market" | "limit";
      price?: string;
    }) =>
      fetchWithAuth(
        `/api/exchange/accounts/${accountId}/positions/${data.symbol}/close`,
        {
          method: "POST",
          body: JSON.stringify({
            quantity: data.quantity,
            type: data.type || "market",
            price: data.price,
          }),
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exchange"] });
    },
  });
}
