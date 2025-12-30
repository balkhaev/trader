"use client";

import { ArrowDownIcon, ArrowUpIcon, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Signal } from "@/hooks/use-signals";
import { cn } from "@/lib/utils";
import { PolymarketContext } from "./polymarket-context";

interface SignalCardProps {
  signal: Signal;
  onApprove?: (signal: Signal) => void;
  onReject?: (signal: Signal) => void;
  onViewDetails?: (signal: Signal) => void;
}

export function SignalCard({
  signal,
  onApprove,
  onReject,
  onViewDetails,
}: SignalCardProps) {
  const isLong = signal.side === "long";
  const strength = Number.parseFloat(signal.strength);
  const isPending = signal.status === "pending";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          {isLong ? (
            <ArrowUpIcon className="h-5 w-5 text-green-500" />
          ) : (
            <ArrowDownIcon className="h-5 w-5 text-red-500" />
          )}
          <CardTitle className="font-semibold text-lg">
            {signal.symbol}
          </CardTitle>
          <Badge variant={isLong ? "default" : "destructive"}>
            {isLong ? "LONG" : "SHORT"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              signal.status === "executed"
                ? "default"
                : signal.status === "rejected"
                  ? "destructive"
                  : signal.status === "expired"
                    ? "secondary"
                    : "outline"
            }
          >
            {signal.status}
          </Badge>
          <span className="flex items-center gap-1 text-muted-foreground text-xs">
            <Clock className="h-3 w-3" />
            {new Date(signal.createdAt).toLocaleString()}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">Strength</span>
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full",
                  strength >= 70
                    ? "bg-green-500"
                    : strength >= 40
                      ? "bg-yellow-500"
                      : "bg-red-500"
                )}
                style={{ width: `${strength}%` }}
              />
            </div>
            <span className="font-medium text-sm">{strength}%</span>
          </div>
        </div>

        {signal.metadata?.reasoning && (
          <p className="line-clamp-2 text-muted-foreground text-sm">
            {signal.metadata.reasoning}
          </p>
        )}

        {signal.metadata?.polymarketContext && (
          <PolymarketContext
            compact
            confidenceAdjustment={signal.metadata.confidenceAdjustment}
            context={signal.metadata.polymarketContext}
            originalStrength={signal.metadata.originalStrength}
            smartMoneySignal={signal.metadata.smartMoneySignal}
          />
        )}

        {isPending && (onApprove || onReject) && (
          <div className="flex gap-2 pt-2">
            {onApprove && (
              <Button
                className="flex-1"
                onClick={() => onApprove(signal)}
                size="sm"
                variant="default"
              >
                Approve
              </Button>
            )}
            {onReject && (
              <Button
                className="flex-1"
                onClick={() => onReject(signal)}
                size="sm"
                variant="outline"
              >
                Reject
              </Button>
            )}
            {onViewDetails && (
              <Button
                onClick={() => onViewDetails(signal)}
                size="sm"
                variant="ghost"
              >
                Details
              </Button>
            )}
          </div>
        )}

        {!isPending && onViewDetails && (
          <Button
            className="w-full"
            onClick={() => onViewDetails(signal)}
            size="sm"
            variant="ghost"
          >
            View Details
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
