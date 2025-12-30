"use client";

import { Bitcoin, Building2, Globe, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useMarketSources } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

export type MarketTypeFilter = "all" | "crypto" | "etf" | "stock" | "moex";

interface MarketFilterProps {
  selected: MarketTypeFilter;
  onChange: (value: MarketTypeFilter) => void;
}

const filterOptions: Array<{
  value: MarketTypeFilter;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    value: "all",
    label: "Все рынки",
    icon: Globe,
    description: "Все источники данных",
  },
  {
    value: "crypto",
    label: "Крипто",
    icon: Bitcoin,
    description: "Binance топ-50",
  },
  {
    value: "etf",
    label: "ETF",
    icon: TrendingUp,
    description: "Yahoo Finance",
  },
  {
    value: "stock",
    label: "S&P 500",
    icon: Building2,
    description: "Акции США",
  },
  {
    value: "moex",
    label: "MOEX",
    icon: Building2,
    description: "Московская биржа",
  },
];

export function MarketFilter({ selected, onChange }: MarketFilterProps) {
  const { data: sourcesData } = useMarketSources();

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex flex-wrap gap-2">
          {filterOptions.map((option) => {
            const Icon = option.icon;
            const isActive = selected === option.value;

            // Check if source is enabled
            const source = sourcesData?.sources?.find((s) =>
              option.value === "all"
                ? true
                : s.marketType.includes(option.value)
            );
            const isEnabled =
              option.value === "all" || source?.enabled !== false;

            return (
              <Button
                className={cn(
                  "flex items-center gap-2 transition-all",
                  isActive && "ring-2 ring-primary ring-offset-2"
                )}
                disabled={!isEnabled}
                key={option.value}
                onClick={() => onChange(option.value)}
                size="sm"
                variant={isActive ? "default" : "outline"}
              >
                <Icon className="h-4 w-4" />
                <span>{option.label}</span>
                {isActive && (
                  <Badge variant="secondary">{option.description}</Badge>
                )}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Компактная версия для мобильных
export function MarketFilterCompact({ selected, onChange }: MarketFilterProps) {
  return (
    <div className="flex gap-1 overflow-x-auto p-1">
      {filterOptions.map((option) => {
        const Icon = option.icon;
        const isActive = selected === option.value;

        return (
          <Button
            className={cn("shrink-0", isActive && "ring-1 ring-primary")}
            key={option.value}
            onClick={() => onChange(option.value)}
            size="sm"
            variant={isActive ? "default" : "ghost"}
          >
            <Icon className="mr-1 h-3 w-3" />
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}
