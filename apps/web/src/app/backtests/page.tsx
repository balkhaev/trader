"use client";

import { HistoryIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLayout, PageLoading } from "@/components/layout";
import { BacktestCard } from "@/components/lean/backtest-card";
import {
  BacktestsFilters,
  type FilterState,
} from "@/components/lean/backtests-filters";
import { DeleteConfirmationDialog } from "@/components/lean/delete-confirmation-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

interface BacktestResult {
  id: string;
  strategyName: string;
  date: string;
  trades: string;
  netProfit: string;
  sharpeRatio: string;
  maxDrawdown: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const defaultFilters: FilterState = {
  strategyName: undefined,
  dateRange: undefined,
  sortBy: "date",
  sortOrder: "desc",
};

export default function BacktestsPage() {
  const [backtests, setBacktests] = useState<BacktestResult[]>([]);
  const [strategies, setStrategies] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);

  const fetchBacktests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filters.strategyName) {
        params.set("strategyName", filters.strategyName);
      }
      if (filters.dateRange?.from) {
        params.set(
          "dateFrom",
          filters.dateRange.from.toISOString().split("T")[0]
        );
      }
      if (filters.dateRange?.to) {
        params.set("dateTo", filters.dateRange.to.toISOString().split("T")[0]);
      }
      params.set("sortBy", filters.sortBy);
      params.set("sortOrder", filters.sortOrder);

      const res = await fetch(`${API_URL}/api/backtests?${params}`);
      if (res.ok) {
        setBacktests(await res.json());
      }
    } catch {
      toast.error("Не удалось загрузить бэктесты");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchStrategies = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/backtests/strategies`);
      if (res.ok) {
        setStrategies(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchBacktests();
  }, [fetchBacktests]);

  useEffect(() => {
    fetchStrategies();
  }, [fetchStrategies]);

  const handleDeleteOne = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`${API_URL}/api/backtests/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setBacktests((prev) => prev.filter((b) => b.id !== id));
        toast.success("Бэктест удален");
      } else {
        toast.error("Не удалось удалить бэктест");
      }
    } catch {
      toast.error("Ошибка при удалении");
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      const params = filters.strategyName
        ? `?strategyName=${encodeURIComponent(filters.strategyName)}`
        : "";
      const res = await fetch(`${API_URL}/api/backtests${params}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const { deleted } = await res.json();
        await fetchBacktests();
        await fetchStrategies();
        toast.success(`Удалено ${deleted} бэктестов`);
      } else {
        toast.error("Не удалось удалить бэктесты");
      }
    } catch {
      toast.error("Ошибка при удалении");
    } finally {
      setDeletingAll(false);
    }
  };

  if (loading) {
    return (
      <PageLayout title="Backtest History">
        <PageLoading count={5} variant="table" />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <DeleteConfirmationDialog
          description={
            filters.strategyName
              ? `Все бэктесты стратегии "${filters.strategyName}" будут удалены безвозвратно.`
              : "Все бэктесты будут удалены безвозвратно. Это действие нельзя отменить."
          }
          isLoading={deletingAll}
          onConfirm={handleDeleteAll}
          title={
            filters.strategyName
              ? `Удалить все бэктесты "${filters.strategyName}"?`
              : "Удалить все бэктесты?"
          }
          trigger={
            <Button
              disabled={backtests.length === 0}
              size="sm"
              variant="destructive"
            >
              <Trash2Icon className="mr-1 size-3" />
              {filters.strategyName
                ? `Delete all (${filters.strategyName})`
                : "Delete all"}
            </Button>
          }
        />
      }
      title="Backtest History"
    >
      <div className="space-y-4">
        <BacktestsFilters
          filters={filters}
          onFiltersChange={setFilters}
          strategies={strategies}
        />

        {backtests.length > 0 ? (
          <div className="space-y-2">
            {backtests.map((backtest) => (
              <BacktestCard
                backtest={backtest}
                isDeleting={deletingId === backtest.id}
                key={backtest.id}
                onDelete={handleDeleteOne}
              />
            ))}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HistoryIcon />
              </EmptyMedia>
              <EmptyTitle>No backtests found</EmptyTitle>
              <EmptyDescription>
                {filters.strategyName || filters.dateRange
                  ? "No backtests match the current filters"
                  : "Run your first backtest from the Strategies page"}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </PageLayout>
  );
}
