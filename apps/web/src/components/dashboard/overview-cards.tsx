"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  DollarSignIcon,
  LayersIcon,
  WalletIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface OverviewCardsProps {
  totalBalance: string;
  totalUnrealizedPnl: string;
  totalPositions: number;
  accountsCount: number;
  isLoading?: boolean;
}

function formatCurrency(value: string): string {
  const num = Number.parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function formatPnl(value: string): { formatted: string; isPositive: boolean } {
  const num = Number.parseFloat(value);
  const isPositive = num >= 0;
  return {
    formatted: `${isPositive ? "+" : ""}${formatCurrency(value)}`,
    isPositive,
  };
}

export function OverviewCards({
  totalBalance,
  totalUnrealizedPnl,
  totalPositions,
  accountsCount,
  isLoading,
}: OverviewCardsProps) {
  const pnl = formatPnl(totalUnrealizedPnl);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-medium text-sm">Total Balance</CardTitle>
          <WalletIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">
            {formatCurrency(totalBalance)}
          </div>
          <p className="text-muted-foreground text-xs">
            Across {accountsCount} account{accountsCount !== 1 ? "s" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-medium text-sm">Unrealized P&L</CardTitle>
          {pnl.isPositive ? (
            <ArrowUpIcon className="h-4 w-4 text-green-500" />
          ) : (
            <ArrowDownIcon className="h-4 w-4 text-red-500" />
          )}
        </CardHeader>
        <CardContent>
          <div
            className={cn(
              "font-bold text-2xl",
              pnl.isPositive ? "text-green-500" : "text-red-500"
            )}
          >
            {pnl.formatted}
          </div>
          <p className="text-muted-foreground text-xs">From open positions</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-medium text-sm">Open Positions</CardTitle>
          <LayersIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{totalPositions}</div>
          <p className="text-muted-foreground text-xs">Active trades</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="font-medium text-sm">Accounts</CardTitle>
          <DollarSignIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="font-bold text-2xl">{accountsCount}</div>
          <p className="text-muted-foreground text-xs">Connected exchanges</p>
        </CardContent>
      </Card>
    </div>
  );
}
