"use client";

import { Minus, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnalyzeSymbol } from "@/hooks/use-market";
import { cn } from "@/lib/utils";

export function QuickAnalyze() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const analyzeMutation = useAnalyzeSymbol();

  const handleAnalyze = () => {
    if (symbol.trim()) {
      analyzeMutation.mutate({ symbol: symbol.toUpperCase(), timeframe });
    }
  };

  const analysis = analyzeMutation.data?.analysis;
  const change24h = analyzeMutation.data?.change24h;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Quick Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            className="flex-1"
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            placeholder="Symbol (e.g., BTCUSDT)"
            value={symbol}
          />
          <Select onValueChange={setTimeframe} value={timeframe}>
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">1H</SelectItem>
              <SelectItem value="4h">4H</SelectItem>
              <SelectItem value="1d">1D</SelectItem>
            </SelectContent>
          </Select>
          <Button
            disabled={analyzeMutation.isPending || !symbol.trim()}
            onClick={handleAnalyze}
          >
            {analyzeMutation.isPending ? "..." : "Analyze"}
          </Button>
        </div>

        {analyzeMutation.isError && (
          <p className="text-red-500 text-sm">
            {analyzeMutation.error.message}
          </p>
        )}

        {analyzeMutation.data && (
          <div className="space-y-3">
            {/* Price */}
            <div className="flex items-center justify-between">
              <span className="font-bold text-2xl">
                $
                {analyzeMutation.data.currentPrice.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
              {change24h && (
                <Badge
                  className="gap-1"
                  variant={
                    change24h.priceChangePercent >= 0
                      ? "default"
                      : "destructive"
                  }
                >
                  {change24h.priceChangePercent >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {change24h.priceChangePercent >= 0 ? "+" : ""}
                  {change24h.priceChangePercent.toFixed(2)}%
                </Badge>
              )}
            </div>

            {/* Indicators */}
            {analysis && (
              <div className="grid grid-cols-2 gap-2 text-sm">
                {analysis.rsi && (
                  <div className="flex justify-between rounded bg-muted p-2">
                    <span>RSI</span>
                    <span
                      className={cn(
                        "font-medium",
                        analysis.rsi.signal === "oversold"
                          ? "text-green-500"
                          : analysis.rsi.signal === "overbought"
                            ? "text-red-500"
                            : ""
                      )}
                    >
                      {analysis.rsi.value.toFixed(1)}
                    </span>
                  </div>
                )}

                {analysis.macd && (
                  <div className="flex justify-between rounded bg-muted p-2">
                    <span>MACD</span>
                    <span
                      className={cn(
                        "flex items-center gap-1 font-medium",
                        analysis.macd.trend === "bullish"
                          ? "text-green-500"
                          : analysis.macd.trend === "bearish"
                            ? "text-red-500"
                            : ""
                      )}
                    >
                      {analysis.macd.trend === "bullish" ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : analysis.macd.trend === "bearish" ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                      {analysis.macd.trend}
                    </span>
                  </div>
                )}

                {analysis.adx && (
                  <div className="flex justify-between rounded bg-muted p-2">
                    <span>ADX</span>
                    <span className="font-medium">
                      {analysis.adx.adx.toFixed(1)} (
                      {analysis.adx.trendStrength})
                    </span>
                  </div>
                )}

                {analysis.atr && (
                  <div className="flex justify-between rounded bg-muted p-2">
                    <span>Volatility</span>
                    <span className="font-medium capitalize">
                      {analysis.atr.volatilityLevel}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Trend */}
            {analysis?.trend && (
              <div className="rounded bg-muted p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium capitalize">
                    {analysis.trend.type.replace("_", " ")}
                  </span>
                  <Badge className="capitalize" variant="outline">
                    {analysis.trend.strength}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <span>Confidence:</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-background">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${analysis.trend.confidence * 100}%` }}
                    />
                  </div>
                  <span>{(analysis.trend.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
