"use client";

import { ChevronDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type OverviewData, useCreateOrder } from "@/hooks/use-exchange";
import { cn } from "@/lib/utils";

interface QuickTradePanelProps {
  accounts: OverviewData["accounts"];
}

const POPULAR_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
];

export function QuickTradePanel({ accounts }: QuickTradePanelProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    accounts[0]?.accountId || ""
  );
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const createOrder = useCreateOrder(selectedAccountId);

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error("Выберите аккаунт");
      return;
    }

    if (!(symbol && quantity)) {
      toast.error("Заполните символ и количество");
      return;
    }

    if (orderType === "limit" && !price) {
      toast.error("Укажите цену для лимитного ордера");
      return;
    }

    try {
      await createOrder.mutateAsync({
        symbol,
        side,
        type: orderType,
        quantity,
        price: orderType === "limit" ? price : undefined,
        stopLoss: stopLoss || undefined,
        takeProfit: takeProfit || undefined,
      });

      toast.success(`Ордер ${side === "buy" ? "покупки" : "продажи"} создан`);

      // Сбрасываем форму
      setQuantity("");
      setPrice("");
      setStopLoss("");
      setTakeProfit("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось создать ордер"
      );
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="h-5 w-5" />
          Quick Trade
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Account Select */}
        <div className="space-y-2">
          <Label>Аккаунт</Label>
          <Select
            onValueChange={setSelectedAccountId}
            value={selectedAccountId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите аккаунт" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.accountId} value={account.accountId}>
                  {account.accountName} ({account.exchange})
                  {account.testnet && " [testnet]"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Symbol */}
        <div className="space-y-2">
          <Label>Символ</Label>
          <Select onValueChange={setSymbol} value={symbol}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POPULAR_SYMBOLS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Side: Buy/Sell */}
        <div className="space-y-2">
          <Label>Направление</Label>
          <Tabs
            className="w-full"
            onValueChange={(v) => setSide(v as "buy" | "sell")}
            value={side}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger
                className={cn(
                  "data-[state=active]:bg-green-500 data-[state=active]:text-white"
                )}
                value="buy"
              >
                Buy / Long
              </TabsTrigger>
              <TabsTrigger
                className={cn(
                  "data-[state=active]:bg-red-500 data-[state=active]:text-white"
                )}
                value="sell"
              >
                Sell / Short
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Order Type: Market/Limit */}
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

        {/* Quantity */}
        <div className="space-y-2">
          <Label>Количество</Label>
          <Input
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.001"
            type="number"
            value={quantity}
          />
        </div>

        {/* Price (only for limit) */}
        {orderType === "limit" && (
          <div className="space-y-2">
            <Label>Цена</Label>
            <Input
              onChange={(e) => setPrice(e.target.value)}
              placeholder="50000"
              type="number"
              value={price}
            />
          </div>
        )}

        {/* Advanced: SL/TP */}
        <Collapsible onOpenChange={setShowAdvanced} open={showAdvanced}>
          <CollapsibleTrigger
            render={
              <Button
                className="w-full justify-between"
                size="sm"
                variant="ghost"
              />
            }
          >
            Stop Loss / Take Profit
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                showAdvanced && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="space-y-2">
              <Label>Stop Loss</Label>
              <Input
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="Цена SL"
                type="number"
                value={stopLoss}
              />
            </div>
            <div className="space-y-2">
              <Label>Take Profit</Label>
              <Input
                onChange={(e) => setTakeProfit(e.target.value)}
                placeholder="Цена TP"
                type="number"
                value={takeProfit}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Submit */}
        <Button
          className={cn(
            "w-full",
            side === "buy"
              ? "bg-green-500 hover:bg-green-600"
              : "bg-red-500 hover:bg-red-600"
          )}
          disabled={createOrder.isPending || !selectedAccountId}
          onClick={handleSubmit}
        >
          {createOrder.isPending
            ? "Создание..."
            : side === "buy"
              ? `Buy ${symbol}`
              : `Sell ${symbol}`}
        </Button>
      </CardContent>
    </Card>
  );
}
