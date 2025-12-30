"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  Shield,
  TrendingDown,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";

interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  strategyType: string;
  riskLevel: string;
  status: string;
  totalReturn: string | null;
  monthlyReturn: string | null;
  sharpeRatio: string | null;
  winRate: string | null;
  totalTrades: number;
  totalAllocated: string;
}

interface AgentsResponse {
  data: Agent[];
  total: number;
  limit: number;
  offset: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchAgents(): Promise<AgentsResponse> {
  const res = await fetch(`${API_BASE}/api/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

async function fetchTopAgents(): Promise<{ agents: Agent[] }> {
  const res = await fetch(`${API_BASE}/api/agents/top?limit=6`);
  if (!res.ok) throw new Error("Failed to fetch top agents");
  return res.json();
}

function getRiskIcon(level: string) {
  switch (level) {
    case "low":
      return <Shield className="h-4 w-4 text-emerald-400" />;
    case "medium":
      return <Activity className="h-4 w-4 text-amber-400" />;
    case "high":
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    default:
      return <Activity className="h-4 w-4 text-zinc-400" />;
  }
}

function getRiskLabel(level: string) {
  switch (level) {
    case "low":
      return "Conservative";
    case "medium":
      return "Balanced";
    case "high":
      return "Aggressive";
    default:
      return level;
  }
}

function getStrategyLabel(type: string) {
  switch (type) {
    case "news":
      return "News Sentiment";
    case "technical":
      return "Technical";
    case "transport":
      return "Transport Data";
    case "macro":
      return "Macro";
    case "prediction":
      return "Prediction Markets";
    case "hybrid":
      return "Hybrid";
    default:
      return type;
  }
}

function AgentCard({ agent }: { agent: Agent }) {
  const returnValue = Number(agent.totalReturn ?? 0);
  const isPositive = returnValue >= 0;

  return (
    <Link href={`/agents/${agent.slug}`}>
      <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-all hover:border-zinc-700 hover:bg-zinc-900">
        {/* Status indicator */}
        <div className="absolute top-4 right-4">
          <div
            className={`h-2 w-2 rounded-full ${
              agent.status === "active"
                ? "bg-emerald-500 shadow-emerald-500/50 shadow-lg"
                : "bg-zinc-600"
            }`}
          />
        </div>

        {/* Avatar and name */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-800">
            {agent.avatarUrl ? (
              <img
                alt={agent.name}
                className="h-10 w-10 rounded"
                src={agent.avatarUrl}
              />
            ) : (
              <Bot className="h-6 w-6 text-zinc-400" />
            )}
          </div>
          <div>
            <h3 className="font-semibold text-white transition-colors group-hover:text-cyan-400">
              {agent.name}
            </h3>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{getStrategyLabel(agent.strategyType)}</span>
              <span>•</span>
              <span className="flex items-center gap-1">
                {getRiskIcon(agent.riskLevel)}
                {getRiskLabel(agent.riskLevel)}
              </span>
            </div>
          </div>
        </div>

        {/* Description */}
        <p className="mb-4 line-clamp-2 text-sm text-zinc-400">
          {agent.description ?? "No description available"}
        </p>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-zinc-800/50 p-2 text-center">
            <div
              className={`flex items-center justify-center gap-1 font-bold text-lg ${
                isPositive ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {isPositive ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {isPositive ? "+" : ""}
              {returnValue.toFixed(1)}%
            </div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Return
            </div>
          </div>

          <div className="rounded-lg bg-zinc-800/50 p-2 text-center">
            <div className="font-bold text-lg text-white">
              {(Number(agent.winRate ?? 0) * 100).toFixed(0)}%
            </div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Win Rate
            </div>
          </div>

          <div className="rounded-lg bg-zinc-800/50 p-2 text-center">
            <div className="font-bold text-lg text-white">
              {agent.totalTrades}
            </div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Trades
            </div>
          </div>
        </div>

        {/* Allocated */}
        <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {Number(agent.totalAllocated).toLocaleString()} allocated
          </span>
          <span className="flex items-center gap-1 text-cyan-400 opacity-0 transition-opacity group-hover:opacity-100">
            View Agent
            <Zap className="h-3 w-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function AgentsPage() {
  const { data: agentsData, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: fetchAgents,
  });

  const { data: topAgents } = useQuery({
    queryKey: ["agents", "top"],
    queryFn: fetchTopAgents,
  });

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600">
              <Bot className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-3xl">AI Trading Agents</h1>
              <p className="text-zinc-400">
                Autonomous agents that trade on your behalf
              </p>
            </div>
          </div>

          {/* Stats bar */}
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                {agentsData?.total ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Active Agents</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-emerald-400">+24.5%</div>
              <div className="text-sm text-zinc-500">Avg. Monthly Return</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">67%</div>
              <div className="text-sm text-zinc-500">Avg. Win Rate</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">$1.2M</div>
              <div className="text-sm text-zinc-500">Total Allocated</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Top Performers */}
        {topAgents?.agents && topAgents.agents.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
              Top Performers
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topAgents.agents.map((agent) => (
                <AgentCard agent={agent} key={agent.id} />
              ))}
            </div>
          </section>
        )}

        {/* All Agents */}
        <section>
          <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
            <Bot className="h-5 w-5 text-zinc-400" />
            All Agents
          </h2>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  className="h-64 animate-pulse rounded-xl bg-zinc-900"
                  key={i}
                />
              ))}
            </div>
          ) : agentsData?.data && agentsData.data.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {agentsData.data.map((agent) => (
                <AgentCard agent={agent} key={agent.id} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 border-dashed p-12 text-center">
              <Bot className="mx-auto mb-4 h-12 w-12 text-zinc-600" />
              <h3 className="mb-2 font-medium text-lg text-zinc-400">
                No agents yet
              </h3>
              <p className="text-sm text-zinc-500">
                Agents will appear here once they are created
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
