"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { groupStatistics } from "@/lib/backtest-utils";

interface StatisticsGroupedProps {
  statistics: Record<string, string>;
}

const CATEGORY_CONFIG = {
  performance: {
    label: "Performance",
    description: "Returns and profit metrics",
  },
  risk: {
    label: "Risk",
    description: "Risk and volatility metrics",
  },
  trades: {
    label: "Trades",
    description: "Trade statistics",
  },
  other: {
    label: "Other",
    description: "Additional metrics",
  },
};

export function StatisticsGrouped({ statistics }: StatisticsGroupedProps) {
  const grouped = useMemo(() => groupStatistics(statistics), [statistics]);

  const categories = Object.entries(grouped).filter(
    ([_, stats]) => Object.keys(stats).length > 0
  ) as [keyof typeof CATEGORY_CONFIG, Record<string, string>][];

  if (categories.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        No statistics available
      </div>
    );
  }

  return (
    <Tabs className="w-full" defaultValue={categories[0]?.[0]}>
      <TabsList className="mb-4">
        {categories.map(([key]) => (
          <TabsTrigger key={key} value={key}>
            {CATEGORY_CONFIG[key].label}
          </TabsTrigger>
        ))}
      </TabsList>

      {categories.map(([key, stats]) => (
        <TabsContent key={key} value={key}>
          <Card>
            <CardContent className="pt-6">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(stats).map(([statKey, value]) => {
                  const isPositive =
                    value.includes("%") && !value.startsWith("-");
                  const isNegative = value.startsWith("-");

                  return (
                    <div
                      className="flex items-center justify-between rounded-lg bg-muted/50 p-3"
                      key={statKey}
                    >
                      <span className="text-muted-foreground text-sm">
                        {statKey}
                      </span>
                      <span
                        className={`font-medium font-mono ${
                          key === "performance" || key === "risk"
                            ? isNegative
                              ? "text-red-500"
                              : isPositive
                                ? "text-green-500"
                                : ""
                            : ""
                        }`}
                      >
                        {value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      ))}
    </Tabs>
  );
}
