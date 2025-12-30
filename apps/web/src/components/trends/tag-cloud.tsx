"use client";

import { Hash } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTags } from "@/hooks/use-trends";
import { cn } from "@/lib/utils";

function getTagSize(mentions: number, maxMentions: number): string {
  const ratio = mentions / Math.max(maxMentions, 1);
  if (ratio > 0.8) return "text-2xl font-bold";
  if (ratio > 0.6) return "text-xl font-semibold";
  if (ratio > 0.4) return "text-lg font-medium";
  if (ratio > 0.2) return "text-base";
  return "text-sm";
}

function getTypeColor(type: string): string {
  switch (type) {
    case "entity":
      return "hover:bg-blue-500/20 hover:text-blue-400";
    case "topic":
      return "hover:bg-purple-500/20 hover:text-purple-400";
    case "event":
      return "hover:bg-amber-500/20 hover:text-amber-400";
    case "region":
      return "hover:bg-emerald-500/20 hover:text-emerald-400";
    default:
      return "hover:bg-zinc-500/20";
  }
}

function getSentimentStyle(sentiment: number): string {
  if (sentiment >= 0.3) return "text-emerald-400";
  if (sentiment >= 0) return "text-zinc-300";
  if (sentiment >= -0.3) return "text-zinc-400";
  return "text-red-400";
}

export function TagCloud() {
  const { tags, loading, error } = useTags({ limit: 50, orderBy: "mentions" });

  const maxMentions = Math.max(...tags.map((t) => t.totalMentions), 1);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Hash className="h-5 w-5 text-emerald-500" />
          <CardTitle className="text-zinc-100">Tag Cloud</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="animate-pulse text-zinc-500">Loading tags...</div>
          </div>
        ) : error ? (
          <div className="flex h-64 items-center justify-center text-red-400">
            Failed to load tags
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-3">
            {tags.map((tag) => (
              <button
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 transition-all",
                  "border border-zinc-800 bg-zinc-800/30",
                  getTagSize(tag.totalMentions, maxMentions),
                  getSentimentStyle(tag.avgSentiment),
                  getTypeColor(tag.type)
                )}
                key={tag.id}
                title={`${tag.name}: ${tag.totalMentions} mentions, sentiment: ${tag.avgSentiment.toFixed(2)}`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
