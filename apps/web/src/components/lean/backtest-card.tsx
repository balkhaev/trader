"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteConfirmationDialog } from "./delete-confirmation-dialog";

interface BacktestResult {
  id: string;
  strategyName: string;
  date: string;
  trades: string;
  netProfit: string;
  sharpeRatio: string;
  maxDrawdown: string;
}

interface BacktestCardProps {
  backtest: BacktestResult;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

export function BacktestCard({
  backtest,
  onDelete,
  isDeleting,
}: BacktestCardProps) {
  return (
    <Card className="group relative cursor-pointer transition-colors hover:bg-muted/50">
      <Link
        className="absolute inset-0 z-0"
        href={`/backtests/${backtest.id}`}
      />

      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{backtest.strategyName}</span>
          <div className="flex items-center gap-2">
            <span
              className={`text-lg ${
                backtest.netProfit.startsWith("-")
                  ? "text-red-500"
                  : "text-green-500"
              }`}
            >
              {backtest.netProfit}
            </span>

            {/* Кнопка удаления - z-10 чтобы была поверх ссылки */}
            <span className="relative z-10 opacity-0 transition-opacity group-hover:opacity-100">
              <DeleteConfirmationDialog
                description={`Бэктест "${backtest.strategyName}" от ${backtest.date} будет удален безвозвратно.`}
                isLoading={isDeleting}
                onConfirm={() => onDelete(backtest.id)}
                title="Удалить бэктест?"
              />
            </span>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Дата</span>
            <p className="font-medium">{backtest.date}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Сделки</span>
            <p className="font-medium">{backtest.trades}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Sharpe</span>
            <p className="font-medium">{backtest.sharpeRatio}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Max DD</span>
            <p className="font-medium text-red-500">{backtest.maxDrawdown}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
