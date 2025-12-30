"use client";

import { useState } from "react";
import {
  MarketFilter,
  MarketHeatmap,
  MarketOverviewCard,
  OpportunitiesTable,
  QuickAnalyze,
  SchedulerControl,
  TrendsTable,
} from "@/components/market";
import type { MarketTypeFilter } from "@/components/market/market-filter";
import {
  useMarketHeatmap,
  useMarketOpportunities,
  useMarketOverview,
  useMarketTrends,
} from "@/hooks/use-market";

export default function MarketPage() {
  const [marketFilter, setMarketFilter] = useState<MarketTypeFilter>("all");

  const overviewQuery = useMarketOverview();
  const heatmapQuery = useMarketHeatmap();
  const opportunitiesQuery = useMarketOpportunities({
    marketType: marketFilter === "all" ? undefined : marketFilter,
    minScore: 60,
    limit: 10,
  });
  const trendsQuery = useMarketTrends({
    marketType: marketFilter === "all" ? undefined : marketFilter,
    limit: 10,
  });

  // Filter heatmap data by market type
  const filteredHeatmapData =
    marketFilter === "all"
      ? heatmapQuery.data?.data
      : heatmapQuery.data?.data?.filter((item) => {
          // Map sectors to market types
          if (marketFilter === "crypto") {
            return (
              item.sector === "crypto" ||
              item.symbol.endsWith("USDT") ||
              item.symbol.endsWith("BTC")
            );
          }
          if (marketFilter === "etf") {
            return (
              item.sector === "etf" ||
              item.sector === "index" ||
              item.sector === "bonds" ||
              item.sector === "commodities"
            );
          }
          if (marketFilter === "stock") {
            return (
              item.sector === "technology" ||
              item.sector === "financials" ||
              item.sector === "healthcare" ||
              item.sector === "consumer_cyclical" ||
              item.sector === "consumer_defensive" ||
              item.sector === "energy"
            );
          }
          if (marketFilter === "moex") {
            return (
              item.sector === "moex" ||
              item.sector === "telecom" ||
              item.sector === "materials" ||
              item.sector === "industrials" ||
              item.sector === "real_estate"
            );
          }
          return true;
        });

  const filteredBySector =
    marketFilter === "all"
      ? heatmapQuery.data?.bySector
      : filteredHeatmapData?.reduce(
          (acc, item) => {
            if (!acc[item.sector]) {
              acc[item.sector] = [];
            }
            acc[item.sector].push(item);
            return acc;
          },
          {} as Record<string, typeof filteredHeatmapData>
        );

  return (
    <div className="container mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="font-bold text-3xl tracking-tight">Market Analysis</h1>
        <p className="text-muted-foreground">
          Анализ трендов, возможностей и технических индикаторов для крипты,
          ETF, SP500 и MOEX
        </p>
      </div>

      {/* Market Filter */}
      <MarketFilter onChange={setMarketFilter} selected={marketFilter} />

      {/* Overview Stats */}
      <MarketOverviewCard
        data={overviewQuery.data}
        isLoading={overviewQuery.isLoading}
      />

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column - Controls */}
        <div className="space-y-6">
          <SchedulerControl />
          <QuickAnalyze />
        </div>

        {/* Right Column - Heatmap */}
        <div className="lg:col-span-2">
          <MarketHeatmap
            bySector={filteredBySector}
            data={filteredHeatmapData}
            isLoading={heatmapQuery.isLoading}
          />
        </div>
      </div>

      {/* Opportunities & Trends */}
      <div className="grid gap-6 lg:grid-cols-2">
        <OpportunitiesTable
          isLoading={opportunitiesQuery.isLoading}
          limit={10}
          opportunities={opportunitiesQuery.data?.opportunities}
          title="Top Opportunities"
        />
        <TrendsTable
          isLoading={trendsQuery.isLoading}
          limit={10}
          title="Active Trends"
          trends={trendsQuery.data?.trends}
        />
      </div>
    </div>
  );
}
