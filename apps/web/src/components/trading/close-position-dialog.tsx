"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type Position, useClosePosition } from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

interface ClosePositionDialogProps {
  position: Position & { accountId: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClosePositionDialog({
  position,
  open,
  onOpenChange,
}: ClosePositionDialogProps) {
  const [closeType, setCloseType] = useState<"full" | "partial">("full");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  const closePosition = useClosePosition(position.accountId);

  const handleClose = async () => {
    try {
      await closePosition.mutateAsync({
        symbol: position.symbol,
        quantity: closeType === "partial" ? quantity : undefined,
        type: orderType,
        price: orderType === "limit" ? price : undefined,
      });

      toast.success("Позиция закрыта");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось закрыть позицию"
      );
    }
  };

  const pnlValue = Number.parseFloat(position.unrealizedPnl);
  const isProfit = pnlValue >= 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Закрыть позицию {position.symbol}</DialogTitle>
          <DialogDescription>
            {position.side === "long" ? "Long" : "Short"} позиция •{" "}
            {position.quantity} @ ${position.entryPrice}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* P&L Info */}
          <div className="rounded-lg bg-muted p-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground text-sm">
                Текущая цена
              </span>
              <span className="font-medium">${position.currentPrice}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground text-sm">
                Нереализованный P&L
              </span>
              <span
                className={cn(
                  "font-medium",
                  isProfit ? "text-green-500" : "text-red-500"
                )}
              >
                {isProfit ? "+" : ""}${pnlValue.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Close Type */}
          <div className="space-y-2">
            <Label>Закрыть</Label>
            <Tabs
              className="w-full"
              onValueChange={(v) => setCloseType(v as "full" | "partial")}
              value={closeType}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="full">Полностью</TabsTrigger>
                <TabsTrigger value="partial">Частично</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Partial Quantity */}
          {closeType === "partial" && (
            <div className="space-y-2">
              <Label>Количество (макс: {position.quantity})</Label>
              <Input
                max={position.quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={position.quantity}
                type="number"
                value={quantity}
              />
            </div>
          )}

          {/* Order Type */}
          <div className="space-y-2">
            <Label>Тип ордера</Label>
            <Tabs
              className="w-full"
              onValueChange={(v) => setOrderType(v as "market" | "limit")}
              value={orderType}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="market">Market</TabsTrigger>
                <TabsTrigger value="limit">Limit</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Limit Price */}
          {orderType === "limit" && (
            <div className="space-y-2">
              <Label>Цена</Label>
              <Input
                onChange={(e) => setPrice(e.target.value)}
                placeholder={position.currentPrice}
                type="number"
                value={price}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Отмена
          </Button>
          <Button
            disabled={
              closePosition.isPending ||
              (closeType === "partial" && !quantity) ||
              (orderType === "limit" && !price)
            }
            onClick={handleClose}
            variant="destructive"
          >
            {closePosition.isPending ? "Закрытие..." : "Закрыть позицию"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
