"use client";

import { MoreVerticalIcon, TrashIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExchangeAccount } from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

interface AccountCardProps {
  account: ExchangeAccount & {
    totalBalance?: string;
    unrealizedPnl?: string;
    positionsCount?: number;
  };
  onDelete?: (id: string) => void;
  isLoading?: boolean;
}

const exchangeLogos: Record<string, string> = {
  bybit: "Bybit",
  binance: "Binance",
  tinkoff: "Tinkoff",
};

function formatCurrency(value: string | undefined): string {
  if (!value) return "$0.00";
  const num = Number.parseFloat(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function AccountCard({
  account,
  onDelete,
  isLoading,
}: AccountCardProps) {
  const pnlValue = Number.parseFloat(account.unrealizedPnl || "0");
  const isPnlPositive = pnlValue >= 0;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-8" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-24" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="transition-colors hover:bg-muted/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="font-medium text-lg">{account.name}</CardTitle>
          <Badge variant="outline">{exchangeLogos[account.exchange]}</Badge>
          {account.testnet && (
            <Badge className="text-xs" variant="secondary">
              Testnet
            </Badge>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button className="h-8 w-8" size="icon" variant="ghost" />}
          >
            <MoreVerticalIcon className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onDelete?.(account.id)}
            >
              <TrashIcon className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="font-bold text-2xl">
          {formatCurrency(account.totalBalance)}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Unrealized P&L</p>
            <p
              className={cn(
                "font-medium",
                isPnlPositive ? "text-green-500" : "text-red-500"
              )}
            >
              {isPnlPositive ? "+" : ""}
              {formatCurrency(account.unrealizedPnl)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Positions</p>
            <p className="font-medium">{account.positionsCount || 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AccountCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-8 w-8" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
