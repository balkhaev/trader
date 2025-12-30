"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OptimizationMethod } from "@/hooks/use-portfolio-optimization";

interface MethodTabsProps {
  value: OptimizationMethod;
  onChange: (method: OptimizationMethod) => void;
}

const METHODS: Array<{
  value: OptimizationMethod;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: "max_sharpe",
    label: "Max Sharpe",
    shortLabel: "Sharpe",
    description:
      "Максимизация коэффициента Шарпа — лучшее соотношение доходности к риску",
  },
  {
    value: "min_volatility",
    label: "Min Volatility",
    shortLabel: "MinVol",
    description: "Минимизация волатильности — наименьший риск портфеля",
  },
  {
    value: "hrp",
    label: "HRP",
    shortLabel: "HRP",
    description:
      "Hierarchical Risk Parity — иерархическое распределение риска без оценки доходности",
  },
  {
    value: "black_litterman",
    label: "Black-Litterman",
    shortLabel: "B-L",
    description:
      "Модель Black-Litterman — использует рыночные подразумеваемые доходности",
  },
];

export function MethodTabs({ value, onChange }: MethodTabsProps) {
  const _selectedMethod = METHODS.find((m) => m.value === value);

  return (
    <div className="space-y-2">
      <Tabs
        onValueChange={(v) => onChange(v as OptimizationMethod)}
        value={value}
      >
        <TabsList className="w-full" variant="line">
          {METHODS.map((method) => (
            <TabsTrigger
              className="flex-1"
              key={method.value}
              value={method.value}
            >
              {method.shortLabel}
            </TabsTrigger>
          ))}
        </TabsList>
        {METHODS.map((method) => (
          <TabsContent key={method.value} value={method.value}>
            <p className="pt-2 text-muted-foreground text-xs">
              {method.description}
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export { METHODS };
