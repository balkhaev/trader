"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export type OptimizationMethod =
  | "max_sharpe"
  | "min_volatility"
  | "efficient_risk"
  | "efficient_return"
  | "hrp"
  | "black_litterman";

export interface OptimizationParams {
  symbols: string[];
  method: OptimizationMethod;
  portfolioValue: number;
  lookbackDays: number;
  riskFreeRate?: number;
  targetReturn?: number;
  targetVolatility?: number;
}

export interface OptimizationResult {
  weights: Record<string, number>;
  expected_return: number;
  volatility: number;
  sharpe_ratio: number;
  discrete_allocation?: Record<string, number>;
  leftover?: number;
}

export interface EfficientFrontierPoint {
  return: number;
  volatility: number;
  sharpe: number;
}

interface UsePortfolioOptimizationResult {
  // Available symbols
  availableSymbols: string[];
  symbolsLoading: boolean;

  // Optimization
  optimize: (params: OptimizationParams) => Promise<OptimizationResult | null>;
  result: OptimizationResult | null;
  loading: boolean;
  error: string | null;

  // Efficient Frontier
  efficientFrontier: EfficientFrontierPoint[] | null;
  loadEfficientFrontier: (
    symbols: string[],
    lookbackDays?: number
  ) => Promise<void>;
  frontierLoading: boolean;

  // Code generation
  generateCode: (
    symbols: string[],
    method: OptimizationMethod,
    lookbackDays: number
  ) => Promise<string | null>;
  generatedCode: string | null;

  // Reset
  reset: () => void;
}

export function usePortfolioOptimization(): UsePortfolioOptimizationResult {
  // Symbols state
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(true);

  // Optimization state
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Efficient Frontier state
  const [efficientFrontier, setEfficientFrontier] = useState<
    EfficientFrontierPoint[] | null
  >(null);
  const [frontierLoading, setFrontierLoading] = useState(false);

  // Code generation state
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  // Load available symbols on mount
  useEffect(() => {
    async function fetchSymbols() {
      try {
        const res = await fetch(`${API_URL}/api/lean/portfolio/symbols`);
        if (res.ok) {
          const data = await res.json();
          setAvailableSymbols(data.symbols || []);
        }
      } catch {
        // Ignore errors, symbols are optional
      } finally {
        setSymbolsLoading(false);
      }
    }

    fetchSymbols();
  }, []);

  // Optimize portfolio
  const optimize = useCallback(
    async (params: OptimizationParams): Promise<OptimizationResult | null> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_URL}/api/lean/portfolio/optimize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbols: params.symbols,
            method: params.method,
            total_portfolio_value: params.portfolioValue,
            lookback_days: params.lookbackDays,
            risk_free_rate: params.riskFreeRate ?? 0.02,
            target_return: params.targetReturn,
            target_volatility: params.targetVolatility,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || data.error || "Optimization failed");
        }

        const data = await res.json();
        setResult(data);
        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setError(message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Load efficient frontier
  const loadEfficientFrontier = useCallback(
    async (symbols: string[], lookbackDays = 365) => {
      if (symbols.length < 2) {
        return;
      }

      setFrontierLoading(true);

      try {
        const res = await fetch(
          `${API_URL}/api/lean/portfolio/efficient-frontier`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbols,
              lookback_days: lookbackDays,
              risk_free_rate: 0.02,
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          setEfficientFrontier(data.frontier || []);
        }
      } catch {
        // Ignore errors
      } finally {
        setFrontierLoading(false);
      }
    },
    []
  );

  // Generate Lean code
  const generateCode = useCallback(
    async (
      symbols: string[],
      method: OptimizationMethod,
      lookbackDays: number
    ): Promise<string | null> => {
      try {
        const res = await fetch(
          `${API_URL}/api/lean/portfolio/generate-weights`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbols,
              method,
              lookback_days: lookbackDays,
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          setGeneratedCode(data.code);
          return data.code;
        }
        return null;
      } catch {
        return null;
      }
    },
    []
  );

  // Reset all state
  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setEfficientFrontier(null);
    setGeneratedCode(null);
  }, []);

  return {
    availableSymbols,
    symbolsLoading,
    optimize,
    result,
    loading,
    error,
    efficientFrontier,
    loadEfficientFrontier,
    frontierLoading,
    generateCode,
    generatedCode,
    reset,
  };
}
