"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AutoTradingDashboardPosition } from "@/hooks/use-auto-trading";

interface OpenPositionsTableProps {
  positions: AutoTradingDashboardPosition[];
}

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const price = new Intl.NumberFormat("ru-RU", {
  maximumFractionDigits: 6,
});

const percent = new Intl.NumberFormat("ru-RU", {
  signDisplay: "exceptZero",
  maximumFractionDigits: 2,
});

export function OpenPositionsTable({ positions }: OpenPositionsTableProps) {
  if (positions.length === 0) {
    return (
      <div className="flex min-h-48 items-center justify-center px-6 text-center text-muted-foreground text-sm">
        Открытых позиций пока нет. Бот добавит их сюда после подходящего
        сигнала.
      </div>
    );
  }

  return (
    <Table>
      <TableCaption className="sr-only">Открытые позиции бота</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Пара</TableHead>
          <TableHead>Вход</TableHead>
          <TableHead>Сейчас</TableHead>
          <TableHead>P&amp;L</TableHead>
          <TableHead>Стоп / цель</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {positions.map((position) => {
          const pnlVariant =
            position.unrealizedPnl < 0 ? "destructive" : "secondary";
          return (
            <TableRow key={position.signalId ?? position.symbol}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{position.symbol}</span>
                  <Badge variant="outline">
                    {position.side === "long" ? "LONG" : "SHORT"}
                  </Badge>
                </div>
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {price.format(position.entryPrice)}
              </TableCell>
              <TableCell className="font-mono tabular-nums">
                {price.format(position.currentPrice)}
              </TableCell>
              <TableCell>
                <Badge variant={pnlVariant}>
                  {money.format(position.unrealizedPnl)} ·{" "}
                  {percent.format(position.unrealizedPnlPercent)}%
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground tabular-nums">
                {position.stopPrice ? price.format(position.stopPrice) : "—"}
                {" / "}
                {position.takeProfitPrice
                  ? price.format(position.takeProfitPrice)
                  : "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
