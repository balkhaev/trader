"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useExchangeAccounts } from "@/hooks/use-exchange";
import { type Signal, useApproveSignal } from "@/hooks/use-signals";

interface SignalApproveDialogProps {
  signal: Signal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SignalApproveDialog({
  signal,
  open,
  onOpenChange,
}: SignalApproveDialogProps) {
  const { data: accounts } = useExchangeAccounts();
  const approveSignal = useApproveSignal();

  const [form, setForm] = useState({
    exchangeAccountId: "",
    quantity: "",
    orderType: "market" as "market" | "limit",
    price: "",
    stopLoss: "",
    takeProfit: "",
  });

  const handleSubmit = async () => {
    if (!signal) return;

    await approveSignal.mutateAsync({
      signalId: signal.id,
      ...form,
    });

    onOpenChange(false);
    setForm({
      exchangeAccountId: "",
      quantity: "",
      orderType: "market",
      price: "",
      stopLoss: "",
      takeProfit: "",
    });
  };

  if (!signal) return null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            Execute {signal.side.toUpperCase()} {signal.symbol}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label>Exchange Account</Label>
            <Select
              onValueChange={(v) => setForm({ ...form, exchangeAccountId: v })}
              value={form.exchangeAccountId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts?.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name} ({acc.exchange})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>Quantity</Label>
            <Input
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="0.001"
              type="text"
              value={form.quantity}
            />
          </div>

          <div className="grid gap-2">
            <Label>Order Type</Label>
            <Select
              onValueChange={(v: "market" | "limit") =>
                setForm({ ...form, orderType: v })
              }
              value={form.orderType}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="market">Market</SelectItem>
                <SelectItem value="limit">Limit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.orderType === "limit" && (
            <div className="grid gap-2">
              <Label>Price</Label>
              <Input
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="Enter price"
                type="text"
                value={form.price}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Stop Loss</Label>
              <Input
                onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
                placeholder="Optional"
                type="text"
                value={form.stopLoss}
              />
            </div>
            <div className="grid gap-2">
              <Label>Take Profit</Label>
              <Input
                onChange={(e) =>
                  setForm({ ...form, takeProfit: e.target.value })
                }
                placeholder="Optional"
                type="text"
                value={form.takeProfit}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              !(form.exchangeAccountId && form.quantity) ||
              approveSignal.isPending
            }
            onClick={handleSubmit}
          >
            {approveSignal.isPending ? "Executing..." : "Execute Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
