"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatProbability,
  formatVolume,
  type MarketOpportunity,
  usePolymarketOpportunities,
} from "@/hooks/use-polymarket";

export function OpportunitiesSection() {
  const {
    data: opportunities,
    loading,
    error,
  } = usePolymarketOpportunities({ limit: 10 });

  if (error) {
    return (
      <div className="text-destructive text-sm">
        Failed to load opportunities: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold text-lg">Hot Opportunities</h2>
      <p className="text-muted-foreground text-sm">
        Active markets with high 24h volume and good liquidity
      </p>

      <OpportunitiesList loading={loading} opportunities={opportunities} />
    </div>
  );
}

function OpportunitiesList({
  opportunities,
  loading,
}: {
  opportunities: MarketOpportunity[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton className="h-24 w-full" key={`opp-skeleton-${i}`} />
        ))}
      </div>
    );
  }

  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No opportunities found. Sync some data first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {opportunities.map((opportunity) => (
        <OpportunityCard key={opportunity.id} opportunity={opportunity} />
      ))}
    </div>
  );
}

function OpportunityCard({ opportunity }: { opportunity: MarketOpportunity }) {
  const probability = formatProbability(opportunity.outcomePrices);
  const outcomes = opportunity.outcomes ?? ["Yes", "No"];

  return (
    <Card
      className="cursor-pointer transition-all hover:ring-2 hover:ring-primary/50"
      onClick={() => {
        window.open(
          `https://polymarket.com/event/${opportunity.event.slug}`,
          "_blank"
        );
      }}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          {opportunity.event.image && (
            <Image
              alt=""
              className="rounded object-cover"
              height={40}
              src={opportunity.event.image}
              width={40}
            />
          )}
          <div className="min-w-0 flex-1">
            <CardTitle className="line-clamp-1 text-sm">
              {opportunity.question}
            </CardTitle>
            <div className="line-clamp-1 text-muted-foreground text-xs">
              {opportunity.event.title}
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {probability !== null && (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-green-600 text-lg">
                  {probability}%
                </span>
                <span className="text-muted-foreground text-xs">
                  {outcomes[0]}
                </span>
              </div>
            )}

            <div className="text-xs">
              <span className="text-muted-foreground">Vol 24h: </span>
              <span className="font-medium">
                {formatVolume(opportunity.volume24hr)}
              </span>
            </div>

            <div className="text-xs">
              <span className="text-muted-foreground">Liq: </span>
              <span className="font-medium">
                {formatVolume(opportunity.liquidity)}
              </span>
            </div>
          </div>

          {opportunity.event.tags && opportunity.event.tags.length > 0 && (
            <div className="flex gap-1">
              {opportunity.event.tags.slice(0, 2).map((tag) => (
                <Badge className="text-[10px]" key={tag.id} variant="secondary">
                  {tag.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
