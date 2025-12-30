"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BarChart3,
  Bot,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";

interface Allocation {
  id: string;
  agentId: string;
  userId: string;
  amount: string;
  currentValue: string;
  pnl: string;
  pnlPercent: string;
  status: string;
  allocatedAt: string;
  agent: {
    id: string;
    name: string;
    slug: string;
    avatarUrl: string | null;
    strategyType: string;
    riskLevel: string;
    status: string;
    totalReturn: string | null;
  };
}

interface Position {
  id: string;
  marketId: string;
  userId: string;
  side: "yes" | "no";
  shares: string;
  avgPrice: string;
  currentValue: string;
  pnl: string;
  pnlPercent: string;
  market: {
    id: string;
    question: string;
    yesPrice: string;
    status: string;
    category: string;
    resolvesAt: string;
  };
}

interface AllocationsResponse {
  data: Allocation[];
  total: number;
}

interface PositionsResponse {
  positions: Position[];
  total: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchAllocations(): Promise<AllocationsResponse> {
  const res = await fetch(`${API_BASE}/api/agents/me/allocations`, {
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) return { data: [], total: 0 };
    throw new Error("Failed to fetch allocations");
  }
  return res.json();
}

async function fetchPositions(): Promise<PositionsResponse> {
  const res = await fetch(`${API_BASE}/api/markets/me/positions`, {
    credentials: "include",
  });
  if (!res.ok) {
    if (res.status === 401) return { positions: [], total: 0 };
    throw new Error("Failed to fetch positions");
  }
  return res.json();
}

function getCategoryColor(category: string) {
  switch (category) {
    case "crypto":
      return "text-orange-400";
    case "macro":
      return "text-blue-400";
    case "corporate":
      return "text-purple-400";
    case "geo":
      return "text-red-400";
    case "commodity":
      return "text-amber-400";
    default:
      return "text-zinc-400";
  }
}

export default function MyPortfolioPage() {
  const { data: allocations, isLoading: loadingAllocations } = useQuery({
    queryKey: ["my", "allocations"],
    queryFn: fetchAllocations,
  });

  const { data: positions, isLoading: loadingPositions } = useQuery({
    queryKey: ["my", "positions"],
    queryFn: fetchPositions,
  });

  // Calculate totals
  const totalAgentValue =
    allocations?.data?.reduce(
      (sum, a) => sum + Number(a.currentValue ?? a.amount),
      0
    ) ?? 0;

  const totalAgentPnL =
    allocations?.data?.reduce((sum, a) => sum + Number(a.pnl ?? 0), 0) ?? 0;

  const totalMarketValue =
    positions?.positions?.reduce(
      (sum, p) => sum + Number(p.currentValue ?? 0),
      0
    ) ?? 0;

  const totalMarketPnL =
    positions?.positions?.reduce((sum, p) => sum + Number(p.pnl ?? 0), 0) ?? 0;

  const totalValue = totalAgentValue + totalMarketValue;
  const totalPnL = totalAgentPnL + totalMarketPnL;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600">
              <Wallet className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-3xl">My Portfolio</h1>
              <p className="text-zinc-400">Your agents and market positions</p>
            </div>
          </div>

          {/* Portfolio Summary */}
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                $
                {totalValue.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="text-sm text-zinc-500">Total Value</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div
                className={`font-bold text-2xl ${totalPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {totalPnL >= 0 ? "+" : ""}${totalPnL.toFixed(2)}
              </div>
              <div className="text-sm text-zinc-500">Total P&L</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                {allocations?.data?.length ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Active Agents</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                {positions?.positions?.length ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Market Positions</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-2">
          {/* Agent Allocations */}
          <section>
            <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
              <Bot className="h-5 w-5 text-cyan-400" />
              Agent Allocations
            </h2>

            {loadingAllocations ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div
                    className="h-24 animate-pulse rounded-xl bg-zinc-900"
                    key={i}
                  />
                ))}
              </div>
            ) : allocations?.data && allocations.data.length > 0 ? (
              <div className="space-y-3">
                {allocations.data.map((allocation) => {
                  const pnl = Number(allocation.pnl ?? 0);
                  const pnlPercent = Number(allocation.pnlPercent ?? 0);
                  const isPositive = pnl >= 0;

                  return (
                    <Link
                      href={`/agents/${allocation.agent.slug}`}
                      key={allocation.id}
                    >
                      <div className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800">
                              {allocation.agent.avatarUrl ? (
                                <img
                                  alt={allocation.agent.name}
                                  className="h-8 w-8 rounded"
                                  src={allocation.agent.avatarUrl}
                                />
                              ) : (
                                <Bot className="h-5 w-5 text-zinc-400" />
                              )}
                            </div>
                            <div>
                              <div className="font-medium text-white group-hover:text-cyan-400">
                                {allocation.agent.name}
                              </div>
                              <div className="text-xs text-zinc-500">
                                {allocation.agent.strategyType} •{" "}
                                {allocation.agent.riskLevel}
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-medium text-white">
                              $
                              {Number(
                                allocation.currentValue ?? allocation.amount
                              ).toLocaleString()}
                            </div>
                            <div
                              className={`flex items-center justify-end gap-1 text-sm ${isPositive ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {isPositive ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {isPositive ? "+" : ""}
                              {pnlPercent.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 border-dashed p-8 text-center">
                <Bot className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
                <p className="mb-3 text-sm text-zinc-500">
                  No agent allocations yet
                </p>
                <Link
                  className="inline-flex items-center gap-1 text-cyan-400 text-sm hover:text-cyan-300"
                  href="/agents"
                >
                  Browse Agents
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </section>

          {/* Market Positions */}
          <section>
            <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
              <BarChart3 className="h-5 w-5 text-purple-400" />
              Market Positions
            </h2>

            {loadingPositions ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div
                    className="h-24 animate-pulse rounded-xl bg-zinc-900"
                    key={i}
                  />
                ))}
              </div>
            ) : positions?.positions && positions.positions.length > 0 ? (
              <div className="space-y-3">
                {positions.positions.map((position) => {
                  const pnl = Number(position.pnl ?? 0);
                  const pnlPercent = Number(position.pnlPercent ?? 0);
                  const isPositive = pnl >= 0;
                  const yesPrice = Number(position.market.yesPrice);

                  return (
                    <Link
                      href={`/markets/${position.marketId}`}
                      key={position.id}
                    >
                      <div className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all hover:border-zinc-700 hover:bg-zinc-900">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 font-medium text-xs ${
                                  position.side === "yes"
                                    ? "bg-emerald-500/10 text-emerald-400"
                                    : "bg-red-500/10 text-red-400"
                                }`}
                              >
                                {position.side.toUpperCase()}
                              </span>
                              <span
                                className={`text-xs ${getCategoryColor(position.market.category)}`}
                              >
                                {position.market.category}
                              </span>
                            </div>
                            <div className="line-clamp-2 font-medium text-sm text-white group-hover:text-purple-400">
                              {position.market.question}
                            </div>
                            <div className="mt-1 text-xs text-zinc-500">
                              {Number(position.shares).toFixed(0)} shares @{" "}
                              {Number(position.avgPrice).toFixed(0)}¢ • Current:{" "}
                              {position.side === "yes"
                                ? yesPrice.toFixed(0)
                                : (100 - yesPrice).toFixed(0)}
                              ¢
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-medium text-white">
                              ${Number(position.currentValue).toFixed(2)}
                            </div>
                            <div
                              className={`flex items-center justify-end gap-1 text-sm ${isPositive ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {isPositive ? (
                                <TrendingUp className="h-3 w-3" />
                              ) : (
                                <TrendingDown className="h-3 w-3" />
                              )}
                              {isPositive ? "+" : ""}
                              {pnlPercent.toFixed(1)}%
                            </div>
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 border-dashed p-8 text-center">
                <Percent className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
                <p className="mb-3 text-sm text-zinc-500">
                  No market positions yet
                </p>
                <Link
                  className="inline-flex items-center gap-1 text-purple-400 text-sm hover:text-purple-300"
                  href="/markets"
                >
                  Browse Markets
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
