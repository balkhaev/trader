"use client";

import { X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type Order,
  type OverviewData,
  useCancelOrder,
  useOpenOrders,
} from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

interface OpenOrdersTableProps {
  accounts: OverviewData["accounts"];
}

interface OrderWithAccount extends Order {
  accountId: string;
  accountName: string;
  exchange: string;
}

export function OpenOrdersTable({ accounts }: OpenOrdersTableProps) {
  // Получаем ордера для всех аккаунтов
  const ordersQueries = accounts.map((account) => ({
    account,
    query: useOpenOrders(account.accountId),
  }));

  const isLoading = ordersQueries.some((q) => q.query.isLoading);

  // Собираем все ордера с информацией об аккаунте
  const allOrders: OrderWithAccount[] = ordersQueries.flatMap(
    ({ account, query }) =>
      (query.data || []).map((order) => ({
        ...order,
        accountId: account.accountId,
        accountName: account.accountName,
        exchange: account.exchange,
      }))
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Открытые ордера</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (allOrders.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Открытые ордера</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">Нет открытых ордеров</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Открытые ордера ({allOrders.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Аккаунт</TableHead>
              <TableHead>Символ</TableHead>
              <TableHead>Сторона</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead className="text-right">Кол-во</TableHead>
              <TableHead className="text-right">Цена</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allOrders.map((order) => (
              <OrderRow key={`${order.accountId}-${order.id}`} order={order} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OrderRow({ order }: { order: OrderWithAccount }) {
  const cancelOrder = useCancelOrder(order.accountId);

  const handleCancel = async () => {
    try {
      await cancelOrder.mutateAsync({
        orderId: order.id,
        symbol: order.symbol,
      });
      toast.success("Ордер отменён");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось отменить ордер"
      );
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{order.accountName}</span>
          <span className="text-muted-foreground text-xs">
            {order.exchange}
          </span>
        </div>
      </TableCell>
      <TableCell className="font-medium">{order.symbol}</TableCell>
      <TableCell>
        <Badge
          className={cn(
            order.side === "buy"
              ? "border-green-500 text-green-500"
              : "border-red-500 text-red-500"
          )}
          variant="outline"
        >
          {order.side === "buy" ? "Buy" : "Sell"}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">
          {order.type === "market" ? "Market" : "Limit"}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{order.quantity}</TableCell>
      <TableCell className="text-right">
        {order.type === "limit" ? `$${order.price}` : "-"}
      </TableCell>
      <TableCell className="text-right">
        <Button
          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
          disabled={cancelOrder.isPending}
          onClick={handleCancel}
          size="sm"
          variant="ghost"
        >
          <X className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
