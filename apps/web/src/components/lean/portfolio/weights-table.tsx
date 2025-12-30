"use client";

import { ArrowUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface WeightsTableProps {
  weights: Record<string, number>;
  allocation?: Record<string, number>;
  portfolioValue: number;
}

type SortField = "symbol" | "weight" | "value" | "units";
type SortOrder = "asc" | "desc";

export function WeightsTable({
  weights,
  allocation,
  portfolioValue,
}: WeightsTableProps) {
  const [sortField, setSortField] = useState<SortField>("weight");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const data = useMemo(() => {
    const items = Object.entries(weights).map(([symbol, weight]) => ({
      symbol,
      weight,
      value: weight * portfolioValue,
      units: allocation?.[symbol] ?? 0,
    }));

    return items.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp =
        typeof aVal === "string"
          ? aVal.localeCompare(bVal as string)
          : (aVal as number) - (bVal as number);
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [weights, allocation, portfolioValue, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 0.3) {
      return "text-green-500";
    }
    if (weight >= 0.15) {
      return "text-blue-500";
    }
    return "text-muted-foreground";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Распределение весов</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button
                  className="-ml-3 h-8"
                  onClick={() => toggleSort("symbol")}
                  size="sm"
                  variant="ghost"
                >
                  Символ
                  <ArrowUpDownIcon className="ml-1 size-3" />
                </Button>
              </TableHead>
              <TableHead className="text-right">
                <Button
                  className="-mr-3 h-8"
                  onClick={() => toggleSort("weight")}
                  size="sm"
                  variant="ghost"
                >
                  Вес
                  <ArrowUpDownIcon className="ml-1 size-3" />
                </Button>
              </TableHead>
              <TableHead className="text-right">
                <Button
                  className="-mr-3 h-8"
                  onClick={() => toggleSort("value")}
                  size="sm"
                  variant="ghost"
                >
                  Сумма
                  <ArrowUpDownIcon className="ml-1 size-3" />
                </Button>
              </TableHead>
              {allocation && (
                <TableHead className="text-right">
                  <Button
                    className="-mr-3 h-8"
                    onClick={() => toggleSort("units")}
                    size="sm"
                    variant="ghost"
                  >
                    Units
                    <ArrowUpDownIcon className="ml-1 size-3" />
                  </Button>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell className="font-medium">{row.symbol}</TableCell>
                <TableCell
                  className={cn("text-right", getWeightColor(row.weight))}
                >
                  {(row.weight * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="text-right">
                  ${row.value.toFixed(2)}
                </TableCell>
                {allocation && (
                  <TableCell className="text-right text-muted-foreground">
                    {row.units}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
