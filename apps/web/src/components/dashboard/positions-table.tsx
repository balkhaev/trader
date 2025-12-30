"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Position } from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

export interface PositionWithAccount extends Position {
  exchange?: string;
  accountName?: string;
  accountId?: string;
}

interface PositionsTableProps {
  positions: PositionWithAccount[];
  isLoading?: boolean;
  showAccount?: boolean;
  renderActions?: (position: PositionWithAccount) => ReactNode;
}

function formatNumber(value: string, decimals = 2): string {
  const num = Number.parseFloat(value);
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPnl(value: string): { formatted: string; isPositive: boolean } {
  const num = Number.parseFloat(value);
  const isPositive = num >= 0;
  return {
    formatted: `${isPositive ? "+" : ""}$${formatNumber(value)}`,
    isPositive,
  };
}

export function PositionsTable({
  positions,
  isLoading,
  showAccount = false,
  renderActions,
}: PositionsTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton className="h-12 w-full" key={i} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Open Positions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-muted-foreground">
            No open positions
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open Positions ({positions.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              {showAccount && <TableHead>Account</TableHead>}
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">Entry</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">P&L</TableHead>
              {renderActions && (
                <TableHead className="text-right">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((position, idx) => {
              const pnl = formatPnl(position.unrealizedPnl);
              return (
                <TableRow key={`${position.symbol}-${idx}`}>
                  <TableCell className="font-medium">
                    {position.symbol}
                    {position.leverage && (
                      <Badge className="ml-2" variant="outline">
                        {position.leverage}x
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        position.side === "long" ? "default" : "destructive"
                      }
                    >
                      {position.side === "long" ? (
                        <ArrowUpIcon className="mr-1 h-3 w-3" />
                      ) : (
                        <ArrowDownIcon className="mr-1 h-3 w-3" />
                      )}
                      {position.side.toUpperCase()}
                    </Badge>
                  </TableCell>
                  {showAccount && (
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm">{position.accountName}</span>
                        <span className="text-muted-foreground text-xs">
                          {position.exchange}
                        </span>
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {formatNumber(position.quantity, 4)}
                  </TableCell>
                  <TableCell className="text-right">
                    ${formatNumber(position.entryPrice)}
                  </TableCell>
                  <TableCell className="text-right">
                    ${formatNumber(position.currentPrice)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      pnl.isPositive ? "text-green-500" : "text-red-500"
                    )}
                  >
                    {pnl.formatted}
                  </TableCell>
                  {renderActions && (
                    <TableCell className="text-right">
                      {renderActions(position)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
