"use client";

import { Button } from "@/components/ui/button";

interface PortfolioPresetsProps {
  onApplySymbols: (symbols: string[]) => void;
  onApplyLookback: (days: number) => void;
}

const SYMBOL_PRESETS = [
  {
    name: "Top 5",
    symbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
  },
  {
    name: "DeFi",
    symbols: ["UNIUSDT", "AAVEUSDT", "MKRUSDT", "COMPUSDT", "SUSHIUSDT"],
  },
  {
    name: "L1",
    symbols: ["ETHUSDT", "SOLUSDT", "AVAXUSDT", "NEARUSDT", "ATOMUSDT"],
  },
  {
    name: "L2",
    symbols: ["MATICUSDT", "ARBUSDT", "OPUSDT", "IMXUSDT", "METISUSDT"],
  },
];

const LOOKBACK_PRESETS = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "180D", days: 180 },
  { label: "1Y", days: 365 },
];

export function PortfolioPresets({
  onApplySymbols,
  onApplyLookback,
}: PortfolioPresetsProps) {
  return (
    <div className="space-y-3">
      {/* Symbol presets */}
      <div>
        <p className="mb-1.5 text-muted-foreground text-xs">
          Пресеты портфелей
        </p>
        <div className="flex flex-wrap gap-1">
          {SYMBOL_PRESETS.map((preset) => (
            <Button
              className="h-7 text-xs"
              key={preset.name}
              onClick={() => onApplySymbols(preset.symbols)}
              size="sm"
              variant="outline"
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Lookback presets */}
      <div>
        <p className="mb-1.5 text-muted-foreground text-xs">Период анализа</p>
        <div className="flex gap-1">
          {LOOKBACK_PRESETS.map((preset) => (
            <Button
              className="h-7 text-xs"
              key={preset.days}
              onClick={() => onApplyLookback(preset.days)}
              size="sm"
              variant="outline"
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

export { SYMBOL_PRESETS, LOOKBACK_PRESETS };
