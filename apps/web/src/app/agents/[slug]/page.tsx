"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Plus,
  Shield,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  strategyType: string;
  strategy: {
    type: string;
    description: string;
    dataSources: string[];
    entryRules: Array<{
      condition: string;
      threshold?: number;
      operator?: string;
    }>;
    exitRules: Array<{ type: string; value: number }>;
    symbols?: string[];
    timeframes?: string[];
  };
  riskParams: {
    maxPositionSize: number;
    maxDrawdown: number;
    maxDailyLoss: number;
    maxOpenPositions: number;
    minTimeBetweenTrades: number;
  };
  riskLevel: string;
  status: string;
  totalReturn: string | null;
  monthlyReturn: string | null;
  sharpeRatio: string | null;
  maxDrawdown: string | null;
  winRate: string | null;
  totalTrades: number;
  avgHoldingPeriodHours: string | null;
  totalAllocated: string;
  createdAt: string;
}

interface Trade {
  id: string;
  symbol: string;
  side: string;
  quantity: string;
  entryPrice: string;
  exitPrice: string | null;
  status: string;
  pnl: string | null;
  pnlPercent: string | null;
  reasoning: string | null;
  confidence: string | null;
  openedAt: string;
  closedAt: string | null;
}

interface TradesResponse {
  data: Trade[];
  total: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchAgent(slug: string): Promise<Agent> {
  const res = await fetch(`${API_BASE}/api/agents/${slug}`);
  if (!res.ok) throw new Error("Failed to fetch agent");
  return res.json();
}

async function fetchTrades(slug: string): Promise<TradesResponse> {
  const res = await fetch(`${API_BASE}/api/agents/${slug}/trades?limit=20`);
  if (!res.ok) throw new Error("Failed to fetch trades");
  return res.json();
}

async function fetchPerformance(slug: string) {
  const res = await fetch(`${API_BASE}/api/agents/${slug}/performance`);
  if (!res.ok) throw new Error("Failed to fetch performance");
  return res.json();
}

function getRiskColor(level: string) {
  switch (level) {
    case "low":
      return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
    case "medium":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "high":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    default:
      return "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
  }
}

function getStatusColor(status: string) {
  switch (status) {
    case "active":
      return "text-emerald-400 bg-emerald-500/10";
    case "paused":
      return "text-amber-400 bg-amber-500/10";
    case "backtesting":
      return "text-blue-400 bg-blue-500/10";
    default:
      return "text-zinc-400 bg-zinc-500/10";
  }
}

export default function AgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const slug = params.slug as string;

  const [allocateAmount, setAllocateAmount] = useState("");
  const [showAllocateModal, setShowAllocateModal] = useState(false);

  const { data: agent, isLoading } = useQuery({
    queryKey: ["agent", slug],
    queryFn: () => fetchAgent(slug),
  });

  const { data: trades } = useQuery({
    queryKey: ["agent", slug, "trades"],
    queryFn: () => fetchTrades(slug),
    enabled: !!agent,
  });

  const { data: performance } = useQuery({
    queryKey: ["agent", slug, "performance"],
    queryFn: () => fetchPerformance(slug),
    enabled: !!agent,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-cyan-500 border-b-2" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        Agent not found
      </div>
    );
  }

  const returnValue = Number(agent.totalReturn ?? 0);
  const isPositive = returnValue >= 0;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Link
            className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            href="/agents"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Agents
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-zinc-800">
                {agent.avatarUrl ? (
                  <img
                    alt={agent.name}
                    className="h-14 w-14 rounded-lg"
                    src={agent.avatarUrl}
                  />
                ) : (
                  <Bot className="h-8 w-8 text-zinc-400" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="font-bold text-2xl">{agent.name}</h1>
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-xs ${getStatusColor(agent.status)}`}
                  >
                    {agent.status}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-zinc-400">
                  {agent.description}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white transition-colors hover:bg-cyan-500"
                onClick={() => setShowAllocateModal(true)}
              >
                <Plus className="h-4 w-4" />
                Allocate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Performance Stats */}
            <div className="grid grid-cols-4 gap-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div
                  className={`flex items-center gap-1 font-bold text-2xl ${isPositive ? "text-emerald-400" : "text-red-400"}`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-5 w-5" />
                  ) : (
                    <TrendingDown className="h-5 w-5" />
                  )}
                  {isPositive ? "+" : ""}
                  {returnValue.toFixed(2)}%
                </div>
                <div className="text-sm text-zinc-500">Total Return</div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="font-bold text-2xl text-white">
                  {Number(agent.sharpeRatio ?? 0).toFixed(2)}
                </div>
                <div className="text-sm text-zinc-500">Sharpe Ratio</div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="font-bold text-2xl text-white">
                  {(Number(agent.winRate ?? 0) * 100).toFixed(0)}%
                </div>
                <div className="text-sm text-zinc-500">Win Rate</div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="font-bold text-2xl text-red-400">
                  {Number(agent.maxDrawdown ?? 0).toFixed(2)}%
                </div>
                <div className="text-sm text-zinc-500">Max Drawdown</div>
              </div>
            </div>

            {/* Performance Chart */}
            <PerformanceChart days={30} slug={slug} />

            {/* Recent Trades */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
              <div className="border-zinc-800 border-b px-5 py-4">
                <h2 className="flex items-center gap-2 font-semibold">
                  <BarChart3 className="h-5 w-5 text-zinc-400" />
                  Recent Trades
                </h2>
              </div>
              <div className="divide-y divide-zinc-800">
                {trades?.data && trades.data.length > 0 ? (
                  trades.data.slice(0, 10).map((trade) => (
                    <div
                      className="flex items-center justify-between px-5 py-3"
                      key={trade.id}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`rounded px-2 py-0.5 font-medium text-xs ${
                            trade.side === "long"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {trade.side.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{trade.symbol}</div>
                          <div className="text-xs text-zinc-500">
                            {new Date(trade.openedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        {trade.status === "closed" ? (
                          <div
                            className={`font-medium ${
                              Number(trade.pnlPercent ?? 0) >= 0
                                ? "text-emerald-400"
                                : "text-red-400"
                            }`}
                          >
                            {Number(trade.pnlPercent ?? 0) >= 0 ? "+" : ""}
                            {Number(trade.pnlPercent ?? 0).toFixed(2)}%
                          </div>
                        ) : (
                          <span className="text-amber-400 text-xs">Open</span>
                        )}
                        <div className="text-xs text-zinc-500">
                          {trade.confidence
                            ? `${(Number(trade.confidence) * 100).toFixed(0)}% conf`
                            : ""}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-zinc-500">
                    No trades yet
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Strategy Info */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-4 font-semibold">Strategy</h2>

              <div className="space-y-4 text-sm">
                <div>
                  <div className="mb-1 text-zinc-500">Type</div>
                  <div className="font-medium capitalize">
                    {agent.strategy.type}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-zinc-500">Data Sources</div>
                  <div className="flex flex-wrap gap-1">
                    {agent.strategy.dataSources.map((source) => (
                      <span
                        className="rounded bg-zinc-800 px-2 py-0.5 text-xs"
                        key={source}
                      >
                        {source}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-zinc-500">Trading Pairs</div>
                  <div className="flex flex-wrap gap-1">
                    {agent.strategy.symbols?.map((symbol) => (
                      <span
                        className="rounded bg-cyan-500/10 px-2 py-0.5 text-cyan-400 text-xs"
                        key={symbol}
                      >
                        {symbol}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-zinc-500">Description</div>
                  <div className="text-zinc-400">
                    {agent.strategy.description}
                  </div>
                </div>
              </div>
            </div>

            {/* Risk Parameters */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <Shield className="h-4 w-4 text-zinc-400" />
                Risk Parameters
              </h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Risk Level</span>
                  <span
                    className={`rounded border px-2 py-0.5 font-medium text-xs ${getRiskColor(agent.riskLevel)}`}
                  >
                    {agent.riskLevel.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Position</span>
                  <span>{agent.riskParams.maxPositionSize}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Drawdown</span>
                  <span>{agent.riskParams.maxDrawdown}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Daily Loss Limit</span>
                  <span>{agent.riskParams.maxDailyLoss}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Max Open Positions</span>
                  <span>{agent.riskParams.maxOpenPositions}</span>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-4 font-semibold">Statistics</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Total Trades</span>
                  <span>{agent.totalTrades}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Avg Hold Time</span>
                  <span>
                    {Number(agent.avgHoldingPeriodHours ?? 0).toFixed(1)}h
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Total Allocated</span>
                  <span>${Number(agent.totalAllocated).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Created</span>
                  <span>{new Date(agent.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Allocate Modal */}
      {showAllocateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6">
            <h3 className="mb-4 font-semibold text-lg">
              Allocate to {agent.name}
            </h3>

            <div className="mb-4">
              <label className="mb-2 block text-sm text-zinc-400">
                Amount ($)
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                onChange={(e) => setAllocateAmount(e.target.value)}
                placeholder="1000"
                type="number"
                value={allocateAmount}
              />
            </div>

            <div className="flex gap-3">
              <button
                className="flex-1 rounded-lg border border-zinc-700 px-4 py-2 text-zinc-400 hover:bg-zinc-800"
                onClick={() => setShowAllocateModal(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500"
                onClick={() => {
                  // TODO: Call allocate API
                  setShowAllocateModal(false);
                }}
              >
                Allocate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
