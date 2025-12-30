"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreateMarketData {
  question: string;
  description: string;
  category: string;
  resolvesAt: string;
  resolutionCriteria: {
    type: string;
    description: string;
    source?: string;
  };
  relatedSymbols?: string[];
  tags?: string[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

async function createMarket(data: CreateMarketData) {
  const res = await fetch(`${API_BASE}/api/markets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error ?? "Failed to create market");
  }
  return res.json();
}

const categories = [
  { value: "crypto", label: "Crypto", color: "text-orange-400" },
  { value: "macro", label: "Macro", color: "text-blue-400" },
  { value: "corporate", label: "Corporate", color: "text-purple-400" },
  { value: "geo", label: "Geopolitical", color: "text-red-400" },
  { value: "commodity", label: "Commodities", color: "text-amber-400" },
  { value: "other", label: "Other", color: "text-zinc-400" },
];

const resolutionTypes = [
  { value: "price", label: "Price Target" },
  { value: "event", label: "Event Outcome" },
  { value: "date", label: "By Date" },
  { value: "manual", label: "Manual Resolution" },
];

export default function CreateMarketPage() {
  const router = useRouter();

  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("crypto");
  const [resolvesAt, setResolvesAt] = useState("");
  const [resolutionType, setResolutionType] = useState("event");
  const [resolutionDescription, setResolutionDescription] = useState("");
  const [resolutionSource, setResolutionSource] = useState("");
  const [symbolsInput, setSymbolsInput] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: createMarket,
    onSuccess: (data) => {
      router.push(`/markets/${data.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!question.trim()) {
      setError("Question is required");
      return;
    }

    if (!resolvesAt) {
      setError("Resolution date is required");
      return;
    }

    if (!resolutionDescription.trim()) {
      setError("Resolution criteria is required");
      return;
    }

    const symbols = symbolsInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    createMutation.mutate({
      question: question.trim(),
      description: description.trim(),
      category,
      resolvesAt: new Date(resolvesAt).toISOString(),
      resolutionCriteria: {
        type: resolutionType,
        description: resolutionDescription.trim(),
        source: resolutionSource.trim() || undefined,
      },
      relatedSymbols: symbols.length > 0 ? symbols : undefined,
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-zinc-800 border-b bg-zinc-950">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Link
            className="mb-4 inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            href="/markets"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Markets
          </Link>

          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600">
              <Plus className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-2xl">Create Market</h1>
              <p className="text-zinc-400">Create a new prediction market</p>
            </div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="mx-auto max-w-3xl px-6 py-8">
        <form className="space-y-6" onSubmit={handleSubmit}>
          {/* Question */}
          <div>
            <label className="mb-2 block font-medium text-sm">
              Question <span className="text-red-400">*</span>
            </label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Will Bitcoin reach $100k by end of 2024?"
              type="text"
              value={question}
            />
            <p className="mt-1 text-xs text-zinc-500">
              Ask a yes/no question that can be objectively resolved
            </p>
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block font-medium text-sm">
              Description
            </label>
            <textarea
              className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context about this prediction..."
              value={description}
            />
          </div>

          {/* Category & Resolution Date */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block font-medium text-sm">
                Category <span className="text-red-400">*</span>
              </label>
              <select
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white focus:border-purple-500 focus:outline-none"
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

            <div>
              <label className="mb-2 block font-medium text-sm">
                Resolution Date <span className="text-red-400">*</span>
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white focus:border-purple-500 focus:outline-none"
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => setResolvesAt(e.target.value)}
                type="date"
                value={resolvesAt}
              />
            </div>
          </div>

          {/* Resolution Criteria */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="mb-4 flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-purple-400" />
              Resolution Criteria
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block font-medium text-sm">
                  Resolution Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {resolutionTypes.map((type) => (
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        resolutionType === type.value
                          ? "border-purple-500 bg-purple-500/10 text-purple-400"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                      }`}
                      key={type.value}
                      onClick={() => setResolutionType(type.value)}
                      type="button"
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block font-medium text-sm">
                  How will this be resolved?{" "}
                  <span className="text-red-400">*</span>
                </label>
                <textarea
                  className="h-20 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
                  onChange={(e) => setResolutionDescription(e.target.value)}
                  placeholder="This market resolves YES if Bitcoin price on CoinGecko exceeds $100,000 at any point before the resolution date."
                  value={resolutionDescription}
                />
              </div>

              <div>
                <label className="mb-2 block font-medium text-sm">
                  Resolution Source (optional)
                </label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
                  onChange={(e) => setResolutionSource(e.target.value)}
                  placeholder="https://coingecko.com/en/coins/bitcoin"
                  type="text"
                  value={resolutionSource}
                />
              </div>
            </div>
          </div>

          {/* Related Symbols & Tags */}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block font-medium text-sm">
                Related Symbols
              </label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
                onChange={(e) => setSymbolsInput(e.target.value)}
                placeholder="BTC, ETH, SPY"
                type="text"
                value={symbolsInput}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Comma-separated list of related trading symbols
              </p>
            </div>

            <div>
              <label className="mb-2 block font-medium text-sm">Tags</label>
              <input
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none"
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="bitcoin, price, 2024"
                type="text"
                value={tagsInput}
              />
              <p className="mt-1 text-xs text-zinc-500">
                Comma-separated list of tags
              </p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Submit */}
          <div className="flex gap-4">
            <Link
              className="flex-1 rounded-lg border border-zinc-700 px-6 py-3 text-center text-zinc-400 transition-colors hover:bg-zinc-800"
              href="/markets"
            >
              Cancel
            </Link>
            <button
              className="flex-1 rounded-lg bg-purple-600 px-6 py-3 font-medium text-white transition-colors hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={createMutation.isPending}
              type="submit"
            >
              {createMutation.isPending ? "Creating..." : "Create Market"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
