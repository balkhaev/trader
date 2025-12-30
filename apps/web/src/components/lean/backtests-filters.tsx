"use client";

import { ArrowDownIcon, ArrowUpIcon, CalendarIcon, XIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FilterState {
  strategyName: string | undefined;
  dateRange: DateRange | undefined;
  sortBy: "date" | "netProfit" | "sharpeRatio";
  sortOrder: "asc" | "desc";
}

interface BacktestsFiltersProps {
  strategies: string[];
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function BacktestsFilters({
  strategies,
  filters,
  onFiltersChange,
}: BacktestsFiltersProps) {
  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const toggleSortOrder = () => {
    updateFilter("sortOrder", filters.sortOrder === "asc" ? "desc" : "asc");
  };

  const formatDateRange = () => {
    if (!filters.dateRange?.from) {
      return "Все даты";
    }
    const from = filters.dateRange.from.toLocaleDateString("ru-RU");
    const to = filters.dateRange.to?.toLocaleDateString("ru-RU") ?? "...";
    return `${from} - ${to}`;
  };

  const clearDateRange = () => {
    updateFilter("dateRange", undefined);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Фильтр по стратегии */}
      <Select
        onValueChange={(v) =>
          updateFilter("strategyName", v === "all" ? undefined : v)
        }
        value={filters.strategyName ?? "all"}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Все стратегии" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Все стратегии</SelectItem>
          {strategies.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Фильтр по дате */}
      <Popover>
        <PopoverTrigger
          render={
            <Button size="sm" variant="outline">
              <CalendarIcon className="mr-2 size-4" />
              {formatDateRange()}
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            numberOfMonths={2}
            onSelect={(range) => updateFilter("dateRange", range)}
            selected={filters.dateRange}
          />
          {filters.dateRange && (
            <div className="border-t p-2">
              <Button
                className="w-full"
                onClick={clearDateRange}
                size="sm"
                variant="ghost"
              >
                <XIcon className="mr-2 size-4" />
                Сбросить даты
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Сортировка */}
      <Select
        onValueChange={(v) =>
          updateFilter("sortBy", v as FilterState["sortBy"])
        }
        value={filters.sortBy}
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="date">По дате</SelectItem>
          <SelectItem value="netProfit">По прибыли</SelectItem>
          <SelectItem value="sharpeRatio">По Sharpe</SelectItem>
        </SelectContent>
      </Select>

      <Button onClick={toggleSortOrder} size="icon" variant="outline">
        {filters.sortOrder === "asc" ? (
          <ArrowUpIcon className="size-4" />
        ) : (
          <ArrowDownIcon className="size-4" />
        )}
      </Button>
    </div>
  );
}
