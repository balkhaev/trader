"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle,
  Clock,
  Flame,
  Info,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

interface Market {
  id: string;
  question: string;
  description: string | null;
  category: string;
  status: string;
  yesPrice: string;
  liquidity: string;
  totalVolume: string;
  yesShares: string;
  noShares: string;
  resolutionCriteria: {
    type: string;
    description: string;
    source?: string;
    targetValue?: number;
    targetDate?: string;
  };
  resolvesAt: string;
  resolvedAt: string | null;
  outcome: string | null;
  resolutionNotes: string | null;
  creationType: string;
  relatedSymbols: string[] | null;
  tags: string[] | null;
  createdAt: string;
}

interface Trade {
  id: string;
  side: string;
  action: string;
  shares: string;
  price: string;
  cost: string;
  priceBeforeTrade: string;
  priceAfterTrade: string;
  createdAt: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function fetchMarket(id: string): Promise<Market> {
  const res = await fetch(`${API_BASE}/api/markets/${id}`);
  if (!res.ok) throw new Error("Failed to fetch market");
  return res.json();
}

async function fetchTrades(id: string): Promise<{ trades: Trade[] }> {
  const res = await fetch(`${API_BASE}/api/markets/${id}/trades?limit=20`);
  if (!res.ok) throw new Error("Failed to fetch trades");
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
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function ProbabilityBar({ yesPrice }: { yesPrice: number }) {
  return (
    <div className="relative h-4 w-full overflow-hidden rounded-full bg-zinc-800">
      <div
        className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
        style={{ width: `${yesPrice}%` }}
      />
      <div className="absolute inset-0 flex items-center justify-center font-bold text-white text-xs">
        {yesPrice.toFixed(0)}% YES
      </div>
    </div>
  );
}

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeSide, setTradeSide] = useState<"yes" | "no">("yes");

  const { data: market, isLoading } = useQuery({
    queryKey: ["market", id],
    queryFn: () => fetchMarket(id),
  });

  const { data: tradesData } = useQuery({
    queryKey: ["market", id, "trades"],
    queryFn: () => fetchTrades(id),
    enabled: !!market,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-8 w-8 animate-spin rounded-full border-purple-500 border-b-2" />
      </div>
    );
  }

  if (!market) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        Market not found
      </div>
    );
  }

  const yesPrice = Number(market.yesPrice);
  const noPrice = 100 - yesPrice;
  const volume = Number(market.totalVolume);
  const isResolved = market.status === "resolved";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Link
            className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            href="/markets"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Markets
          </Link>

          <div className="flex items-start gap-4">
            <div
              className={`rounded-full border px-3 py-1 font-medium text-sm ${getCategoryColor(market.category)}`}
            >
              {market.category}
            </div>
            {market.creationType === "ai" && (
              <span className="flex items-center gap-1 text-purple-400 text-sm">
                <Flame className="h-4 w-4" />
                AI Generated
              </span>
            )}
          </div>

          <h1 className="mt-4 font-bold text-2xl md:text-3xl">
            {market.question}
          </h1>

          {market.description && (
            <p className="mt-2 max-w-3xl text-zinc-400">{market.description}</p>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Probability */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-4 font-semibold">Current Probability</h2>

              <ProbabilityBar yesPrice={yesPrice} />

              <div className="mt-4 grid grid-cols-2 gap-4">
                <div
                  className={`rounded-xl p-4 ${tradeSide === "yes" ? "border-2 border-emerald-500 bg-emerald-500/10" : "bg-zinc-800/50"} cursor-pointer transition-all`}
                  onClick={() => setTradeSide("yes")}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                    <span className="font-semibold">YES</span>
                  </div>
                  <div className="mt-2 font-bold text-3xl text-emerald-400">
                    {yesPrice.toFixed(0)}¢
                  </div>
                  <div className="text-sm text-zinc-500">
                    Payout $1.00 if YES
                  </div>
                </div>

                <div
                  className={`rounded-xl p-4 ${tradeSide === "no" ? "border-2 border-red-500 bg-red-500/10" : "bg-zinc-800/50"} cursor-pointer transition-all`}
                  onClick={() => setTradeSide("no")}
                >
                  <div className="flex items-center gap-2">
                    <XCircle className="h-5 w-5 text-red-400" />
                    <span className="font-semibold">NO</span>
                  </div>
                  <div className="mt-2 font-bold text-3xl text-red-400">
                    {noPrice.toFixed(0)}¢
                  </div>
                  <div className="text-sm text-zinc-500">
                    Payout $1.00 if NO
                  </div>
                </div>
              </div>

              {/* Trade form */}
              {!isResolved && (
                <div className="mt-6 border-zinc-800 border-t pt-6">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className="mb-2 block text-sm text-zinc-400">
                        Amount ($)
                      </label>
                      <input
                        className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                        onChange={(e) => setTradeAmount(e.target.value)}
                        placeholder="100"
                        type="number"
                        value={tradeAmount}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        className={`rounded-lg px-8 py-2 font-medium text-white transition-colors ${
                          tradeSide === "yes"
                            ? "bg-emerald-600 hover:bg-emerald-500"
                            : "bg-red-600 hover:bg-red-500"
                        }`}
                      >
                        Buy {tradeSide.toUpperCase()}
                      </button>
                    </div>
                  </div>

                  {tradeAmount && (
                    <div className="mt-4 rounded-lg bg-zinc-800/50 p-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-zinc-400">Est. Shares</span>
                        <span>
                          {(
                            (Number(tradeAmount) /
                              (tradeSide === "yes" ? yesPrice : noPrice)) *
                            100
                          ).toFixed(2)}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-between">
                        <span className="text-zinc-400">Potential Profit</span>
                        <span className="text-emerald-400">
                          +$
                          {(
                            (Number(tradeAmount) /
                              (tradeSide === "yes" ? yesPrice : noPrice)) *
                              100 -
                            Number(tradeAmount)
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resolved */}
              {isResolved && (
                <div className="mt-6 border-zinc-800 border-t pt-6">
                  <div
                    className={`rounded-lg p-4 ${
                      market.outcome === "yes"
                        ? "border border-emerald-500/20 bg-emerald-500/10"
                        : market.outcome === "no"
                          ? "border border-red-500/20 bg-red-500/10"
                          : "border border-zinc-500/20 bg-zinc-500/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {market.outcome === "yes" ? (
                        <CheckCircle className="h-5 w-5 text-emerald-400" />
                      ) : market.outcome === "no" ? (
                        <XCircle className="h-5 w-5 text-red-400" />
                      ) : (
                        <Info className="h-5 w-5 text-zinc-400" />
                      )}
                      <span className="font-semibold">
                        Resolved: {market.outcome?.toUpperCase()}
                      </span>
                    </div>
                    {market.resolutionNotes && (
                      <p className="mt-2 text-sm text-zinc-400">
                        {market.resolutionNotes}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Recent Trades */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
              <div className="border-zinc-800 border-b px-5 py-4">
                <h2 className="flex items-center gap-2 font-semibold">
                  <BarChart3 className="h-5 w-5 text-zinc-400" />
                  Recent Activity
                </h2>
              </div>
              <div className="divide-y divide-zinc-800">
                {tradesData?.trades && tradesData.trades.length > 0 ? (
                  tradesData.trades.slice(0, 15).map((trade) => (
                    <div
                      className="flex items-center justify-between px-5 py-3"
                      key={trade.id}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`rounded px-2 py-0.5 font-medium text-xs ${
                            trade.side === "yes"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {trade.action.toUpperCase()}{" "}
                          {trade.side.toUpperCase()}
                        </div>
                        <div className="text-sm">
                          {Number(trade.shares).toFixed(2)} shares @{" "}
                          {trade.price}¢
                        </div>
                      </div>

                      <div className="text-right text-xs text-zinc-500">
                        {new Date(trade.createdAt).toLocaleTimeString()}
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
            {/* Market Info */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-4 font-semibold">Market Info</h2>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Status</span>
                  <span
                    className={`rounded px-2 py-0.5 font-medium text-xs ${
                      market.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : market.status === "resolved"
                          ? "bg-blue-500/10 text-blue-400"
                          : "bg-zinc-500/10 text-zinc-400"
                    }`}
                  >
                    {market.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Volume</span>
                  <span>${volume.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Liquidity</span>
                  <span>${Number(market.liquidity).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Time Left</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {getTimeLeft(market.resolvesAt)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Ends</span>
                  <span>
                    {new Date(market.resolvesAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Resolution Criteria */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <Info className="h-4 w-4 text-zinc-400" />
                Resolution
              </h2>

              <div className="space-y-3 text-sm">
                <div>
                  <div className="mb-1 text-zinc-500">Type</div>
                  <div className="font-medium capitalize">
                    {market.resolutionCriteria.type}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-zinc-500">Criteria</div>
                  <div className="text-zinc-400">
                    {market.resolutionCriteria.description}
                  </div>
                </div>
                {market.resolutionCriteria.source && (
                  <div>
                    <div className="mb-1 text-zinc-500">Source</div>
                    <div className="text-cyan-400">
                      {market.resolutionCriteria.source}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Related */}
            {market.relatedSymbols && market.relatedSymbols.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="mb-4 font-semibold">Related Symbols</h2>
                <div className="flex flex-wrap gap-2">
                  {market.relatedSymbols.map((symbol) => (
                    <span
                      className="rounded bg-cyan-500/10 px-2 py-1 text-cyan-400 text-sm"
                      key={symbol}
                    >
                      {symbol}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {market.tags && market.tags.length > 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
                <h2 className="mb-4 font-semibold">Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {market.tags.map((tag) => (
                    <span
                      className="rounded bg-zinc-800 px-2 py-1 text-sm text-zinc-400"
                      key={tag}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
