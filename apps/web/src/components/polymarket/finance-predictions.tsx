"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  formatVolume,
  type PolymarketEvent,
  usePolymarketFinance,
  usePolymarketStats,
} from "@/hooks/use-polymarket";
import { PredictionCard, PredictionCardSkeleton } from "./prediction-card";

export function FinancePredictions() {
  const {
    data: events,
    loading,
    error,
    refetch,
  } = usePolymarketFinance({ limit: 12 });
  const { data: stats } = usePolymarketStats();

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Error loading predictions</AlertTitle>
        <AlertDescription className="flex items-center justify-between">
          <span>{error}</span>
          <Button onClick={refetch} size="sm" variant="outline">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Active Events"
            value={stats.activeEvents.toLocaleString()}
          />
          <StatCard
            label="Total Markets"
            value={stats.totalMarkets.toLocaleString()}
          />
          <StatCard
            label="Total Volume"
            value={formatVolume(stats.totalVolume)}
          />
          <StatCard
            label="Total Events"
            value={stats.totalEvents.toLocaleString()}
          />
        </div>
      )}

      <div>
        <h2 className="mb-4 font-semibold text-lg">Finance Predictions</h2>
        <PredictionsList events={events} loading={loading} />
      </div>
    </div>
  );
}

function PredictionsList({
  events,
  loading,
}: {
  events: PolymarketEvent[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <PredictionCardSkeleton key={`skeleton-${i}`} />
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        No finance predictions found. Try syncing data first.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {events.map((event) => (
        <PredictionCard
          event={event}
          key={event.id}
          onClick={() => {
            window.open(`https://polymarket.com/event/${event.slug}`, "_blank");
          }}
        />
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-muted-foreground text-xs uppercase">{label}</div>
      <div className="font-semibold text-2xl">{value}</div>
    </div>
  );
}
