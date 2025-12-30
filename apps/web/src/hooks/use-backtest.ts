"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface BacktestResult {
  id: string;
  strategyName: string;
  date: string;
  statistics: Record<string, string>;
  equity: Array<{ date: number; value: number }>;
  trades: string;
  netProfit: string;
  sharpeRatio: string;
  maxDrawdown: string;
}

export interface Trade {
  id: string;
  time: number;
  symbol: string;
  direction: "buy" | "sell";
  price: number;
  quantity: number;
}

interface UseBacktestResult {
  backtest: BacktestResult | null;
  trades: Trade[];
  logs: string;
  loading: boolean;
  error: string | null;
  fetchLogs: () => Promise<void>;
}

export function useBacktest(id: string): UseBacktestResult {
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const [backtestRes, tradesRes] = await Promise.all([
          fetch(`${API_URL}/api/lean/backtests/${id}`),
          fetch(`${API_URL}/api/lean/backtests/${id}/trades`),
        ]);

        if (!backtestRes.ok) {
          throw new Error("Failed to fetch backtest");
        }

        setBacktest(await backtestRes.json());

        if (tradesRes.ok) {
          setTrades(await tradesRes.json());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [id]);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_URL}/api/lean/backtests/${id}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
      }
    } catch (err) {
      // Игнорируем ошибки загрузки логов
    }
  };

  return { backtest, trades, logs, loading, error, fetchLogs };
}
