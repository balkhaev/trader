"use client";

import { ArrowDown, ArrowUp, Target } from "lucide-react";
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
import type { MarketAsset, MarketOpportunity } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

interface OpportunitiesTableProps {
  opportunities?: Array<MarketOpportunity & { asset: MarketAsset }>;
  isLoading?: boolean;
  title?: string;
  limit?: number;
}

export function OpportunitiesTable({
  opportunities,
  isLoading,
  title = "Top Opportunities",
  limit = 10,
}: OpportunitiesTableProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton className="h-12 w-full" key={i} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const displayOpportunities = opportunities?.slice(0, limit) || [];

  if (displayOpportunities.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-muted-foreground text-sm">
            No opportunities found
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden md:table-cell">Entry</TableHead>
              <TableHead className="hidden md:table-cell">Target</TableHead>
              <TableHead className="hidden lg:table-cell">R:R</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayOpportunities.map((opp) => (
              <TableRow key={opp.id}>
                <TableCell className="font-medium">
                  <div className="flex flex-col">
                    <span>{opp.asset.symbol}</span>
                    <span className="text-muted-foreground text-xs">
                      {opp.asset.sector}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    className="gap-1"
                    variant={
                      opp.direction === "long" ? "default" : "destructive"
                    }
                  >
                    {opp.direction === "long" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {opp.direction.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div
                    className={cn(
                      "font-bold",
                      Number(opp.score) >= 80
                        ? "text-green-500"
                        : Number(opp.score) >= 70
                          ? "text-emerald-500"
                          : Number(opp.score) >= 60
                            ? "text-yellow-500"
                            : "text-muted-foreground"
                    )}
                  >
                    {Number(opp.score).toFixed(0)}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge className="text-xs" variant="outline">
                    {opp.type.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {opp.entryPrice
                    ? `$${Number(opp.entryPrice).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}`
                    : "-"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {opp.targetPrice
                    ? `$${Number(opp.targetPrice).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}`
                    : "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {opp.riskRewardRatio
                    ? `${Number(opp.riskRewardRatio).toFixed(2)}`
                    : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
