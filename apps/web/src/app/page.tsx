"use client";

import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  Newspaper,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  AccountCard,
  AccountCardSkeleton,
} from "@/components/dashboard/account-card";
import { AddAccountDialog } from "@/components/dashboard/add-account-dialog";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useDeleteExchangeAccount,
  useExchangeOverview,
} from "@/hooks/use-exchange";
import {
  type NewsArticle,
  useNewsArticles,
  useNewsStats,
} from "@/hooks/use-news";
import {
  type Signal,
  usePendingSignals,
  useRejectSignal,
  useSignalStats,
} from "@/hooks/use-signals";

function PendingSignalRow({
  signal,
  onReject,
  isRejecting,
}: {
  signal: Signal;
  onReject: (id: string) => void;
  isRejecting: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-border/50 border-b px-2 py-1.5 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-2">
        <div
          className={`flex h-5 w-5 items-center justify-center rounded ${
            signal.side === "long" ? "bg-green-500/20" : "bg-red-500/20"
          }`}
        >
          {signal.side === "long" ? (
            <ArrowUp className="h-3 w-3 text-green-500" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-500" />
          )}
        </div>
        <span className="font-mono text-sm">{signal.symbol}</span>
        <Badge className="text-[10px]" variant="outline">
          {signal.source}
        </Badge>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground text-xs">
          {signal.strength ? `${signal.strength}%` : ""}
        </span>
        <Link href={`/signals?id=${signal.id}`}>
          <Button className="h-6 w-6 p-0" size="sm" variant="ghost">
            <Check className="h-3 w-3" />
          </Button>
        </Link>
        <Button
          className="h-6 w-6 p-0"
          disabled={isRejecting}
          onClick={() => onReject(signal.id)}
          size="sm"
          variant="ghost"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function NewsRow({ article }: { article: NewsArticle }) {
  return (
    <div className="flex items-start justify-between gap-2 border-border/50 border-b px-2 py-1.5 last:border-0 hover:bg-muted/30">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{article.title}</p>
        <div className="mt-0.5 flex items-center gap-2">
          {article.category && (
            <Badge className="text-[10px]" variant="secondary">
              {article.category}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            {new Date(article.publishedAt).toLocaleString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
      <Button
        className="h-6 w-6 shrink-0 p-0"
        onClick={() => window.open(article.url, "_blank")}
        size="sm"
        variant="ghost"
      >
        <ExternalLink className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default function DashboardPage() {
  const { data: overview, isLoading: overviewLoading } = useExchangeOverview();
  const { data: pendingSignals, isLoading: signalsLoading } =
    usePendingSignals();
  const { data: signalStats } = useSignalStats();
  const { data: newsArticles, isLoading: newsLoading } = useNewsArticles({
    limit: 8,
    hoursAgo: 24,
  });
  const { data: newsStats } = useNewsStats();
  const deleteAccount = useDeleteExchangeAccount();
  const rejectSignal = useRejectSignal();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const formatBalance = (value: string) => {
    const num = Number.parseFloat(value);
    if (Number.isNaN(num)) return "$0.00";
    return `$${num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatPnl = (value: string) => {
    const num = Number.parseFloat(value);
    if (Number.isNaN(num)) return "0.00";
    const sign = num >= 0 ? "+" : "";
    return `${sign}$${Math.abs(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const handleDelete = async (id: string) => {
    setIsDeleting(id);
    try {
      await deleteAccount.mutateAsync(id);
    } finally {
      setIsDeleting(null);
    }
  };

  const pnlValue = Number.parseFloat(overview?.totalUnrealizedPnl || "0");

  return (
    <PageLayout
      actions={<AddAccountDialog />}
      subtitle="Overview of trading accounts, signals and news"
      title="Dashboard"
    >
      {/* Stats Row */}
      <StatRow>
        <StatItem
          label="Total Balance"
          value={
            overviewLoading
              ? "..."
              : formatBalance(overview?.totalBalance || "0")
          }
        />
        <StatItem
          change={
            pnlValue !== 0
              ? { value: Math.abs(pnlValue), isPositive: pnlValue >= 0 }
              : undefined
          }
          label="Unrealized P&L"
          value={
            overviewLoading
              ? "..."
              : formatPnl(overview?.totalUnrealizedPnl || "0")
          }
        />
        <StatItem label="Pending Signals" value={signalStats?.pending || 0} />
        <StatItem label="News 24h" value={newsStats?.articlesLast24h || 0} />
      </StatRow>

      {/* Main Grid */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Pending Signals */}
        <TerminalPanel
          action={
            <Link href="/signals">
              <Button className="h-6 px-2 text-xs" size="sm" variant="ghost">
                All
              </Button>
            </Link>
          }
          subtitle={`${pendingSignals?.length || 0} pending`}
          title="Signals"
        >
          {signalsLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton className="h-8 w-full" key={i} />
              ))}
            </div>
          ) : !pendingSignals || pendingSignals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
              <Activity className="mb-2 h-6 w-6 opacity-50" />
              <p className="text-xs">No pending signals</p>
            </div>
          ) : (
            <div>
              {pendingSignals.slice(0, 6).map((signal) => (
                <PendingSignalRow
                  isRejecting={rejectSignal.isPending}
                  key={signal.id}
                  onReject={(id) => rejectSignal.mutate({ signalId: id })}
                  signal={signal}
                />
              ))}
            </div>
          )}
        </TerminalPanel>

        {/* Recent News */}
        <TerminalPanel
          action={
            <Link href="/news">
              <Button className="h-6 px-2 text-xs" size="sm" variant="ghost">
                All
              </Button>
            </Link>
          }
          subtitle={`${newsStats?.articlesLast24h || 0} today`}
          title="News"
        >
          {newsLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton className="h-10 w-full" key={i} />
              ))}
            </div>
          ) : !newsArticles || newsArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center text-muted-foreground">
              <Newspaper className="mb-2 h-6 w-6 opacity-50" />
              <p className="text-xs">No news articles</p>
            </div>
          ) : (
            <div>
              {newsArticles.slice(0, 6).map((article) => (
                <NewsRow article={article} key={article.id} />
              ))}
            </div>
          )}
        </TerminalPanel>
      </div>

      {/* Exchange Accounts */}
      <div className="mt-4">
        <TerminalPanel
          action={
            <Link href="/exchanges">
              <Button className="h-6 px-2 text-xs" size="sm" variant="ghost">
                Manage
              </Button>
            </Link>
          }
          subtitle={`${overview?.accountsCount || 0} connected`}
          title="Accounts"
        >
          <div className="grid gap-3 p-1 md:grid-cols-2 xl:grid-cols-3">
            {overviewLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <AccountCardSkeleton key={i} />
              ))
            ) : overview?.accounts.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center py-8 text-center">
                <Wallet className="mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="font-semibold text-sm">No connected accounts</h3>
                <p className="mt-1 text-muted-foreground text-xs">
                  Connect an exchange to start trading
                </p>
              </div>
            ) : (
              overview?.accounts.slice(0, 3).map((account) => (
                <AccountCard
                  account={{
                    id: account.accountId,
                    exchange: account.exchange as
                      | "bybit"
                      | "binance"
                      | "tinkoff",
                    name: account.accountName,
                    testnet: account.testnet,
                    enabled: true,
                    createdAt: "",
                    totalBalance: account.totalBalance,
                    unrealizedPnl: account.unrealizedPnl,
                    positionsCount: account.positionsCount,
                  }}
                  key={account.accountId}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
