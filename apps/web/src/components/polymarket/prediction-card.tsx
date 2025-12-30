"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatVolume, type PolymarketEvent } from "@/hooks/use-polymarket";
import { cn } from "@/lib/utils";

interface PredictionCardProps {
  event: PolymarketEvent;
  onClick?: () => void;
}

export function PredictionCard({ event, onClick }: PredictionCardProps) {
  const volume24hr = event.volume24hr;
  const totalVolume = event.volume;
  const liquidity = event.liquidity;

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:ring-2 hover:ring-primary/50",
        onClick && "hover:bg-muted/30"
      )}
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start gap-3">
          {event.image && (
            <img
              alt=""
              className="h-12 w-12 rounded object-cover"
              height={48}
              src={event.image}
              width={48}
            />
          )}
          <div className="flex-1 space-y-1">
            <CardTitle className="line-clamp-2 text-sm leading-tight">
              {event.title}
            </CardTitle>
            {event.tags && event.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {event.tags.slice(0, 3).map((tag) => (
                  <Badge
                    className="text-[10px]"
                    key={tag.id}
                    variant="secondary"
                  >
                    {tag.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        {event.description && (
          <CardDescription className="mt-2 line-clamp-2">
            {event.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">
              Volume 24h
            </div>
            <div className="font-medium text-sm">
              {formatVolume(volume24hr)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">
              Total Volume
            </div>
            <div className="font-medium text-sm">
              {formatVolume(totalVolume)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">
              Liquidity
            </div>
            <div className="font-medium text-sm">{formatVolume(liquidity)}</div>
          </div>
        </div>

        {event.endDate && (
          <div className="text-muted-foreground text-xs">
            Ends: {new Date(event.endDate).toLocaleDateString("ru-RU")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PredictionCardSkeletonProps {
  className?: string;
}

export function PredictionCardSkeleton({
  className,
}: PredictionCardSkeletonProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 animate-pulse rounded bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div className="space-y-1 text-center" key={i}>
              <div className="mx-auto h-2 w-12 animate-pulse rounded bg-muted" />
              <div className="mx-auto h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
