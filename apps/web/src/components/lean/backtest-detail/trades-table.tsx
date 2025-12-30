"use client";

import { Download, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  calculateTradeProfit,
  exportTradesToCSV,
  type Trade,
} from "@/lib/backtest-utils";

interface TradesTableProps {
  trades: Trade[];
}

const ITEMS_PER_PAGE_OPTIONS = [25, 50, 100];

export function TradesTable({ trades }: TradesTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [filterDirection, setFilterDirection] = useState<
    "all" | "buy" | "sell"
  >("all");

  // Вычисляем прибыль по сделкам
  const tradesWithProfit = useMemo(
    () => calculateTradeProfit(trades),
    [trades]
  );

  // Фильтрация
  const filteredTrades = useMemo(() => {
    if (filterDirection === "all") return tradesWithProfit;
    return tradesWithProfit.filter((t) => t.direction === filterDirection);
  }, [tradesWithProfit, filterDirection]);

  // Пагинация
  const totalPages = Math.ceil(filteredTrades.length / itemsPerPage);
  const paginatedTrades = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredTrades.slice(start, start + itemsPerPage);
  }, [filteredTrades, currentPage, itemsPerPage]);

  // Статистика
  const stats = useMemo(() => {
    const profits = tradesWithProfit.filter((t) => t.profit && t.profit > 0);
    const losses = tradesWithProfit.filter((t) => t.profit && t.profit < 0);
    const totalProfit = tradesWithProfit.reduce(
      (sum, t) => sum + (t.profit ?? 0),
      0
    );

    return {
      total: tradesWithProfit.length,
      wins: profits.length,
      losses: losses.length,
      totalProfit,
    };
  }, [tradesWithProfit]);

  const handleExport = () => {
    const csv = exportTradesToCSV(tradesWithProfit);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select
              onValueChange={(v) => {
                setFilterDirection(v as "all" | "buy" | "sell");
                setCurrentPage(1);
              }}
              value={filterDirection}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All trades</SelectItem>
                <SelectItem value="buy">Buy only</SelectItem>
                <SelectItem value="sell">Sell only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">Total: {stats.total}</Badge>
            <Badge className="text-green-600" variant="outline">
              Wins: {stats.wins}
            </Badge>
            <Badge className="text-red-600" variant="outline">
              Losses: {stats.losses}
            </Badge>
            <Badge
              className={
                stats.totalProfit >= 0 ? "text-green-600" : "text-red-600"
              }
              variant="outline"
            >
              P/L: ${stats.totalProfit.toFixed(2)}
            </Badge>
          </div>
        </div>

        <Button onClick={handleExport} size="sm" variant="outline">
          <Download className="mr-2 size-4" />
          Export CSV
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Profit/Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedTrades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell>{new Date(trade.time).toLocaleString()}</TableCell>
                <TableCell className="font-mono">{trade.symbol}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      trade.direction === "buy" ? "default" : "destructive"
                    }
                  >
                    {trade.direction.toUpperCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${trade.price.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {Math.abs(trade.quantity).toFixed(4)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {trade.profit !== undefined && trade.profit !== 0 ? (
                    <span
                      className={
                        trade.profit >= 0 ? "text-green-500" : "text-red-500"
                      }
                    >
                      {trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Show:</span>
          <Select
            onValueChange={(v) => {
              setItemsPerPage(Number(v));
              setCurrentPage(1);
            }}
            value={itemsPerPage.toString()}
          >
            <SelectTrigger className="w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ITEMS_PER_PAGE_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt.toString()}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-sm">
            of {filteredTrades.length} trades
          </span>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              disabled={currentPage === 1}
              onClick={() => handlePageChange(currentPage - 1)}
              size="sm"
              variant="outline"
            >
              Previous
            </Button>

            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    onClick={() => handlePageChange(pageNum)}
                    size="sm"
                    variant={currentPage === pageNum ? "default" : "outline"}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              disabled={currentPage === totalPages}
              onClick={() => handlePageChange(currentPage + 1)}
              size="sm"
              variant="outline"
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
