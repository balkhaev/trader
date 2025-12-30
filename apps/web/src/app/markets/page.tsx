"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Clock,
  Filter,
  Flame,
  Search,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

interface Market {
  id: string;
  question: string;
  description: string | null;
  category: string;
  status: string;
  yesPrice: string;
  totalVolume: string;
  yesShares: string;
  noShares: string;
  resolvesAt: string;
  resolvedAt: string | null;
  outcome: string | null;
  creationType: string;
  createdAt: string;
}

interface MarketsResponse {
  data: Market[];
  total: number;
  limit: number;
  offset: number;
}

interface MarketStats {
  totalMarkets: number;
  activeMarkets: number;
  totalVolume: number;
  marketsByCategory: Record<string, number>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchMarkets(
  status?: string,
  category?: string
): Promise<MarketsResponse> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (category) params.set("category", category);

  const res = await fetch(`${API_BASE}/api/markets?${params}`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  return res.json();
}

async function fetchTrending(): Promise<{ markets: Market[] }> {
  const res = await fetch(`${API_BASE}/api/markets/trending?limit=6`);
  if (!res.ok) throw new Error("Failed to fetch trending");
  return res.json();
}

async function fetchStats(): Promise<MarketStats> {
  const res = await fetch(`${API_BASE}/api/markets/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

function getCategoryColor(category: string) {
  switch (category) {
    case "crypto":
      return "bg-orange-500/10 text-orange-400 border-orange-500/20";
    case "macro":
      return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    case "corporate":
      return "bg-purple-500/10 text-purple-400 border-purple-500/20";
    case "geo":
      return "bg-red-500/10 text-red-400 border-red-500/20";
    case "commodity":
      return "bg-amber-500/10 text-amber-400 border-amber-500/20";
    default:
      return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  }
}

function getTimeLeft(resolvesAt: string) {
  const now = new Date();
  const resolves = new Date(resolvesAt);
  const diff = resolves.getTime() - now.getTime();

  if (diff <= 0) return "Ended";

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h`;
}

function ProbabilityBar({ yesPrice }: { yesPrice: number }) {
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400"
        style={{ width: `${yesPrice}%` }}
      />
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const yesPrice = Number(market.yesPrice);
  const noPrice = 100 - yesPrice;
  const volume = Number(market.totalVolume);

  return (
    <Link href={`/markets/${market.id}`}>
      <div className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-all hover:border-zinc-700 hover:bg-zinc-900">
        {/* Category and time */}
        <div className="mb-3 flex items-center justify-between">
          <span
            className={`rounded-full border px-2 py-0.5 font-medium text-xs ${getCategoryColor(market.category)}`}
          >
            {market.category}
          </span>
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <Clock className="h-3 w-3" />
            {getTimeLeft(market.resolvesAt)}
          </span>
        </div>

        {/* Question */}
        <h3 className="mb-4 line-clamp-2 font-semibold text-white transition-colors group-hover:text-cyan-400">
          {market.question}
        </h3>

        {/* Probability bar */}
        <div className="mb-3">
          <ProbabilityBar yesPrice={yesPrice} />
        </div>

        {/* Yes/No prices */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded bg-emerald-500/10 px-2 py-1 font-bold text-emerald-400 text-sm">
              YES {yesPrice.toFixed(0)}¢
            </span>
            <span className="rounded bg-red-500/10 px-2 py-1 font-bold text-red-400 text-sm">
              NO {noPrice.toFixed(0)}¢
            </span>
          </div>
        </div>

        {/* Volume and type */}
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />$
            {volume > 1000
              ? `${(volume / 1000).toFixed(1)}K`
              : volume.toFixed(0)}{" "}
            volume
          </span>
          {market.creationType === "ai" && (
            <span className="flex items-center gap-1 text-purple-400">
              <Flame className="h-3 w-3" />
              AI Generated
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

const categories = [
  { value: "", label: "All Categories" },
  { value: "crypto", label: "Crypto" },
  { value: "macro", label: "Macro" },
  { value: "corporate", label: "Corporate" },
  { value: "geo", label: "Geopolitical" },
  { value: "commodity", label: "Commodities" },
  { value: "other", label: "Other" },
];

export default function MarketsPage() {
  const [category, setCategory] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: marketsData, isLoading } = useQuery({
    queryKey: ["markets", "active", category],
    queryFn: () => fetchMarkets("active", category || undefined),
  });

  const { data: trending } = useQuery({
    queryKey: ["markets", "trending"],
    queryFn: fetchTrending,
  });

  const { data: stats } = useQuery({
    queryKey: ["markets", "stats"],
    queryFn: fetchStats,
  });

  const filteredMarkets = marketsData?.data?.filter((m) =>
    searchQuery
      ? m.question.toLowerCase().includes(searchQuery.toLowerCase())
      : true
  );

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600">
              <TrendingUp className="h-8 w-8 text-white" />
            </div>
            <div className="flex-1">
              <h1 className="font-bold text-3xl">Prediction Markets</h1>
              <p className="text-zinc-400">
                Trade on the outcome of real-world events
              </p>
            </div>

            <Link
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
              href="/markets/create"
            >
              <Plus className="h-4 w-4" />
              Create Market
            </Link>
          </div>

          {/* Stats bar */}
          <div className="mt-8 grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                {stats?.activeMarkets ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Active Markets</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                ${((stats?.totalVolume ?? 0) / 1000).toFixed(1)}K
              </div>
              <div className="text-sm text-zinc-500">Total Volume</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-white">
                {stats?.marketsByCategory?.crypto ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Crypto Markets</div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="font-bold text-2xl text-purple-400">
                {stats?.totalMarkets ?? 0}
              </div>
              <div className="text-sm text-zinc-500">Total Markets</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Trending */}
        {trending?.markets && trending.markets.length > 0 && (
          <section className="mb-12">
            <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
              <Flame className="h-5 w-5 text-orange-400" />
              Trending Markets
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trending.markets.map((market) => (
                <MarketCard key={market.id} market={market} />
              ))}
            </div>
          </section>
        )}

        {/* Filters */}
        <div className="mb-6 flex items-center gap-4">
          <div className="relative max-w-md flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pr-4 pl-10 text-white placeholder-zinc-500 focus:border-zinc-700 focus:outline-none"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search markets..."
              type="text"
              value={searchQuery}
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-zinc-500" />
            <select
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white focus:border-zinc-700 focus:outline-none"
              onChange={(e) => setCategory(e.target.value)}
              value={category}
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* All Markets */}
        <section>
          <h2 className="mb-6 flex items-center gap-2 font-semibold text-xl">
            <BarChart3 className="h-5 w-5 text-zinc-400" />
            All Markets
          </h2>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  className="h-48 animate-pulse rounded-xl bg-zinc-900"
                  key={i}
                />
              ))}
            </div>
          ) : filteredMarkets && filteredMarkets.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredMarkets.map((market) => (
                <MarketCard key={market.id} market={market} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-800 border-dashed p-12 text-center">
              <TrendingUp className="mx-auto mb-4 h-12 w-12 text-zinc-600" />
              <h3 className="mb-2 font-medium text-lg text-zinc-400">
                No markets found
              </h3>
              <p className="text-sm text-zinc-500">
                Markets will appear here once they are created
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
