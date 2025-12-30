"use client";

import {
  Brain,
  ExternalLink,
  Newspaper,
  Play,
  RefreshCw,
  Settings,
  Square,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type NewsArticle,
  useAnalyzeArticle,
  useFetchAllNews,
  useNewsArticles,
  useNewsSources,
  useNewsStats,
} from "@/hooks/use-news";
import {
  useAddPresetSource,
  useNewsWebSocket,
  usePresetSources,
  useRealtimeControl,
  useRealtimeStatus,
} from "@/hooks/use-news-realtime";

const CATEGORY_COLORS: Record<string, string> = {
  crypto: "bg-orange-500/20 text-orange-400",
  stocks: "bg-blue-500/20 text-blue-400",
  forex: "bg-green-500/20 text-green-400",
  macro: "bg-purple-500/20 text-purple-400",
  regulation: "bg-red-500/20 text-red-400",
  technology: "bg-cyan-500/20 text-cyan-400",
};

function NewsRow({
  article,
  onAnalyze,
  isAnalyzing,
  isNew,
}: {
  article: NewsArticle;
  onAnalyze: (id: string) => void;
  isAnalyzing: boolean;
  isNew?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-3 border-border/50 border-b px-3 py-2 last:border-0 hover:bg-muted/30 ${isNew ? "bg-green-500/10" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isNew && (
            <Badge className="bg-green-500/20 text-[10px] text-green-400">
              NEW
            </Badge>
          )}
          <p className="line-clamp-1 text-sm">{article.title}</p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {article.category && (
            <Badge
              className={`text-[10px] ${CATEGORY_COLORS[article.category] || "bg-gray-500/20"}`}
              variant="secondary"
            >
              {article.category}
            </Badge>
          )}
          {article.symbols && article.symbols.length > 0 && (
            <div className="flex gap-1">
              {article.symbols.slice(0, 2).map((symbol) => (
                <Badge className="text-[10px]" key={symbol} variant="outline">
                  {symbol}
                </Badge>
              ))}
              {article.symbols.length > 2 && (
                <span className="text-[10px] text-muted-foreground">
                  +{article.symbols.length - 2}
                </span>
              )}
            </div>
          )}
          <span className="text-[10px] text-muted-foreground">
            {new Date(article.publishedAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          className="h-7 px-2"
          disabled={isAnalyzing}
          onClick={() => onAnalyze(article.id)}
          size="sm"
          variant="ghost"
        >
          {isAnalyzing ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <Brain className="h-3 w-3" />
          )}
        </Button>
        <Button
          className="h-7 px-2"
          onClick={() => window.open(article.url, "_blank")}
          size="sm"
          variant="ghost"
        >
          <ExternalLink className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export default function NewsPage() {
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  // Data hooks
  const { data: articles, isLoading } = useNewsArticles({
    limit: 50,
    hoursAgo: 48,
  });
  const { data: sources } = useNewsSources();
  const { data: stats } = useNewsStats();
  const fetchAll = useFetchAllNews();
  const analyzeArticle = useAnalyzeArticle();

  // Realtime hooks
  const { data: realtimeStatus } = useRealtimeStatus();
  const { startRealtime, stopRealtime } = useRealtimeControl();
  const { data: presets } = usePresetSources();
  const addPreset = useAddPresetSource();

  const { connected, realtimeArticles } = useNewsWebSocket({
    onArticle: (article) => {
      toast.success(`Новая статья: ${article.title.slice(0, 50)}...`);
    },
    enabled: true, // Всегда подключаемся, сервер автоматически запускает realtime
  });

  // Merge articles (realtime first, then regular, deduplicate by id)
  const allArticles = [...realtimeArticles, ...(articles || [])];
  const uniqueArticles = allArticles.filter(
    (a, i, arr) => arr.findIndex((x) => x.id === a.id) === i
  );
  const realtimeIds = new Set(realtimeArticles.map((a) => a.id));

  const handleAnalyze = async (articleId: string) => {
    setAnalyzingId(articleId);
    try {
      await analyzeArticle.mutateAsync(articleId);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleToggleRealtime = () => {
    if (realtimeStatus?.isRunning) {
      stopRealtime.mutate();
      toast.info("Realtime остановлен");
    } else {
      startRealtime.mutate();
      toast.success("Realtime запущен");
    }
  };

  const handleAddPreset = (key: string, name: string) => {
    addPreset.mutate(key, {
      onSuccess: () => toast.success(`Источник ${name} добавлен`),
      onError: () => toast.error(`Ошибка добавления ${name}`),
    });
  };

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-2">
          {/* WebSocket indicator */}
          <Badge className="h-8" variant={connected ? "default" : "secondary"}>
            {connected ? (
              <Wifi className="mr-1 h-3 w-3" />
            ) : (
              <WifiOff className="mr-1 h-3 w-3" />
            )}
            {connected ? "Live" : "Offline"}
          </Badge>

          {/* Realtime toggle */}
          <Button
            className="h-8"
            disabled={startRealtime.isPending || stopRealtime.isPending}
            onClick={handleToggleRealtime}
            size="sm"
            variant={realtimeStatus?.isRunning ? "destructive" : "default"}
          >
            {realtimeStatus?.isRunning ? (
              <Square className="mr-1 h-3 w-3" />
            ) : (
              <Play className="mr-1 h-3 w-3" />
            )}
            {realtimeStatus?.isRunning ? "Stop" : "Start"}
          </Button>

          <Button asChild className="h-8" size="sm" variant="outline">
            <a href="/news/sources">
              <Settings className="mr-1 h-3 w-3" />
              Sources
            </a>
          </Button>
          <Button
            className="h-8"
            disabled={fetchAll.isPending}
            onClick={() => fetchAll.mutate()}
            size="sm"
            variant="outline"
          >
            {fetchAll.isPending ? (
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Fetch
          </Button>
        </div>
      }
      subtitle="Financial news from configured sources"
      title="News Feed"
    >
      {/* Stats Row */}
      <StatRow>
        <StatItem label="Sources" value={stats?.totalSources || 0} />
        <StatItem label="Articles" value={stats?.totalArticles || 0} />
        <StatItem label="Analyzed" value={stats?.totalAnalyses || 0} />
        <StatItem label="Last 24h" value={stats?.articlesLast24h || 0} />
        <StatItem
          label="Realtime"
          value={realtimeStatus?.isRunning ? "ON" : "OFF"}
        />
        <StatItem
          label="WS Clients"
          value={realtimeStatus?.connectedClients || 0}
        />
      </StatRow>

      {/* Preset Sources */}
      {presets && presets.length > 0 && (
        <div className="mt-4">
          <TerminalPanel subtitle="Quick add" title="Preset Sources">
            <div className="flex flex-wrap gap-1 p-2">
              {presets.map((preset) => (
                <Button
                  className="h-7"
                  disabled={addPreset.isPending}
                  key={preset.key}
                  onClick={() => handleAddPreset(preset.key, preset.name)}
                  size="sm"
                  variant="outline"
                >
                  <Zap className="mr-1 h-3 w-3" />
                  {preset.name}
                </Button>
              ))}
            </div>
          </TerminalPanel>
        </div>
      )}

      {/* Sources */}
      {sources && sources.length > 0 && (
        <div className="mt-4">
          <TerminalPanel
            subtitle={`${sources.length} configured`}
            title="Sources"
          >
            <div className="flex flex-wrap gap-1 p-1">
              {sources.map((source) => (
                <Badge
                  key={source.id}
                  variant={source.enabled ? "default" : "secondary"}
                >
                  {source.name}
                </Badge>
              ))}
            </div>
          </TerminalPanel>
        </div>
      )}

      {/* Articles */}
      <div className="mt-4">
        <TerminalPanel
          subtitle={`${uniqueArticles.length} articles${realtimeArticles.length > 0 ? ` (${realtimeArticles.length} new)` : ""}`}
          title="Recent Articles"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin" />
            </div>
          ) : uniqueArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Newspaper className="mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">No articles yet</p>
              <p className="text-xs">
                Add a news source and fetch articles to get started
              </p>
            </div>
          ) : (
            <div>
              {uniqueArticles.map((article) => (
                <NewsRow
                  article={article}
                  isAnalyzing={analyzingId === article.id}
                  isNew={realtimeIds.has(article.id)}
                  key={article.id}
                  onAnalyze={handleAnalyze}
                />
              ))}
            </div>
          )}
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
