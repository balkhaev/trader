"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatProbabilityChange,
  getAlignmentColor,
  getAlignmentLabel,
  getDivergenceBadgeVariant,
  getSentimentColor,
} from "@/hooks/use-polymarket";
import type {
  ConfidenceAdjustment,
  PolymarketContextInSignal,
  SmartMoneySignal,
} from "@/hooks/use-signals";
import { cn } from "@/lib/utils";

interface PolymarketContextProps {
  context: PolymarketContextInSignal;
  confidenceAdjustment?: ConfidenceAdjustment;
  smartMoneySignal?: SmartMoneySignal;
  originalStrength?: number;
  compact?: boolean;
}

export function PolymarketContext({
  context,
  confidenceAdjustment,
  smartMoneySignal,
  originalStrength,
  compact = false,
}: PolymarketContextProps) {
  const topEvents = context.events.slice(0, compact ? 1 : 2);
  const hasSignificantDivergence =
    context.validation.divergenceLevel === "significant" ||
    context.validation.divergenceLevel === "major";

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-purple-500" />
        <span className="font-medium text-sm">Polymarket Context</span>
      </div>

      {topEvents.length > 0 && (
        <div className="space-y-2">
          {topEvents.map((event, i) => (
            <div className="flex items-center justify-between text-xs" key={i}>
              <span className="line-clamp-1 flex-1 text-muted-foreground">
                {event.title}
              </span>
              <div className="ml-2 flex items-center gap-2">
                <span className="font-medium">
                  {Math.round(event.probability * 100)}%
                </span>
                <span
                  className={cn(
                    "flex items-center gap-0.5",
                    event.change24h >= 0 ? "text-green-500" : "text-red-500"
                  )}
                >
                  {event.change24h >= 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {formatProbabilityChange(event.change24h)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {smartMoneySignal && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Smart Money</span>
          <Badge
            className={cn(
              "capitalize",
              getSentimentColor(smartMoneySignal.sentiment)
            )}
            variant="outline"
          >
            {smartMoneySignal.sentiment}
          </Badge>
        </div>
      )}

      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Alignment</span>
        <div className="flex items-center gap-2">
          <span
            className={cn("font-medium", getAlignmentColor(context.alignment))}
          >
            {context.alignment >= 0 ? "+" : ""}
            {context.alignment.toFixed(2)}
          </span>
          {context.validation.isAligned ? (
            <CheckCircle className="h-3 w-3 text-green-500" />
          ) : (
            <AlertTriangle className="h-3 w-3 text-yellow-500" />
          )}
        </div>
      </div>

      {confidenceAdjustment && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <span>
            <span className="text-muted-foreground">
              {Math.round(confidenceAdjustment.originalConfidence * 100)}%
            </span>
            <span className="mx-1">&rarr;</span>
            <span className="font-medium">
              {Math.round(confidenceAdjustment.adjustedConfidence * 100)}%
            </span>
          </span>
        </div>
      )}

      {hasSignificantDivergence && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-yellow-500/10 p-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />
          <div className="text-xs">
            <Badge
              variant={getDivergenceBadgeVariant(
                context.validation.divergenceLevel
              )}
            >
              {context.validation.divergenceLevel} divergence
            </Badge>
            {context.validation.divergenceExplanation && (
              <p className="mt-1 text-muted-foreground">
                {context.validation.divergenceExplanation}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface AlignmentIndicatorProps {
  score: number;
  showLabel?: boolean;
  size?: "sm" | "md";
}

export function AlignmentIndicator({
  score,
  showLabel = true,
  size = "md",
}: AlignmentIndicatorProps) {
  const color = getAlignmentColor(score);
  const label = getAlignmentLabel(score);
  const barWidth = Math.abs(score) * 50 + 50;

  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          "overflow-hidden rounded-full bg-secondary",
          size === "sm" ? "h-1.5 w-16" : "h-2 w-24"
        )}
      >
        <div
          className={cn(
            "h-full rounded-full transition-all",
            score >= 0.5
              ? "bg-green-500"
              : score >= 0
                ? "bg-yellow-500"
                : "bg-red-500"
          )}
          style={{ width: `${barWidth}%` }}
        />
      </div>
      {showLabel && <span className={cn("text-xs", color)}>{label}</span>}
    </div>
  );
}

interface SmartMoneyBadgeProps {
  sentiment: "bullish" | "bearish" | "neutral";
  confidence?: number;
}

export function SmartMoneyBadge({
  sentiment,
  confidence,
}: SmartMoneyBadgeProps) {
  return (
    <Badge
      className={cn("capitalize", getSentimentColor(sentiment))}
      variant="outline"
    >
      {sentiment}
      {confidence !== undefined && (
        <span className="ml-1 text-muted-foreground">
          ({Math.round(confidence * 100)}%)
        </span>
      )}
    </Badge>
  );
}
