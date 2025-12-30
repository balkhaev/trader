"use client";

import { AlertCircleIcon, CodeIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { PageLayout, StatItem, StatRow } from "@/components/layout";
import {
  EfficientFrontierChart,
  MethodTabs,
  PortfolioPresets,
  ResultsSkeleton,
  SymbolMultiSelect,
  WeightsTable,
} from "@/components/lean/portfolio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type OptimizationMethod,
  usePortfolioOptimization,
} from "@/hooks/use-portfolio-optimization";

const COLORS = [
  "#22c55e",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

export default function PortfolioPage() {
  // Form state
  const [symbols, setSymbols] = useState<string[]>([
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
  ]);
  const [method, setMethod] = useState<OptimizationMethod>("max_sharpe");
  const [portfolioValue, setPortfolioValue] = useState<number>(10_000);
  const [lookbackDays, setLookbackDays] = useState<number>(365);

  // Hook
  const {
    availableSymbols,
    symbolsLoading,
    optimize,
    result,
    loading,
    error,
    efficientFrontier,
    loadEfficientFrontier,
    frontierLoading,
    generateCode,
    generatedCode,
  } = usePortfolioOptimization();

  // Handlers
  const handleOptimize = async () => {
    if (symbols.length < 2) {
      return;
    }

    await optimize({
      symbols,
      method,
      portfolioValue,
      lookbackDays,
    });

    // Also load efficient frontier
    loadEfficientFrontier(symbols, lookbackDays);
  };

  const handleGenerateCode = async () => {
    if (!result) {
      return;
    }
    await generateCode(symbols, method, lookbackDays);
  };

  const handleCopyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
    }
  };

  // Pie chart data
  const pieData = result
    ? Object.entries(result.weights).map(([name, value]) => ({
        name,
        value: Math.round(value * 10_000) / 100,
      }))
    : [];

  // Results panel renderer
  const renderResultsPanel = () => {
    if (loading) {
      return <ResultsSkeleton />;
    }

    if (result) {
      return (
        <TerminalPanel title="Оптимальные веса">
          <ResponsiveContainer height={250} width="100%">
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={pieData}
                dataKey="value"
                innerRadius={60}
                label={({ name, value }) => `${name}: ${value}%`}
                labelLine={false}
                outerRadius={100}
              >
                {pieData.map((entry) => (
                  <Cell
                    fill={COLORS[pieData.indexOf(entry) % COLORS.length]}
                    key={entry.name}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value}%`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </TerminalPanel>
      );
    }

    return (
      <TerminalPanel title="Результат">
        <div className="flex h-full min-h-[250px] items-center justify-center text-muted-foreground text-xs">
          Выберите символы и запустите оптимизацию
        </div>
      </TerminalPanel>
    );
  };

  return (
    <PageLayout
      subtitle="PyPortfolioOpt — оптимизация весов портфеля"
      title="Portfolio Optimization"
    >
      {/* Main Tabs */}
      <Tabs className="space-y-4" defaultValue="optimize">
        <TabsList variant="line">
          <TabsTrigger value="optimize">Оптимизация</TabsTrigger>
          <TabsTrigger value="frontier">Efficient Frontier</TabsTrigger>
        </TabsList>

        {/* Optimize Tab */}
        <TabsContent className="mt-4" value="optimize">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Form Panel */}
            <TerminalPanel contentClassName="space-y-4 p-3" title="Параметры">
              {/* Presets */}
              <PortfolioPresets
                onApplyLookback={setLookbackDays}
                onApplySymbols={setSymbols}
              />

              {/* Symbols */}
              <div className="space-y-1.5">
                <span className="font-medium text-xs">Символы</span>
                <SymbolMultiSelect
                  availableSymbols={availableSymbols}
                  loading={symbolsLoading}
                  onChange={setSymbols}
                  placeholder="Выберите символы..."
                  value={symbols}
                />
              </div>

              {/* Method */}
              <div className="space-y-1.5">
                <span className="font-medium text-xs">Метод оптимизации</span>
                <MethodTabs onChange={setMethod} value={method} />
              </div>

              {/* Portfolio Value */}
              <div className="space-y-1.5">
                <span className="font-medium text-xs">Сумма портфеля ($)</span>
                <Input
                  min={100}
                  onChange={(e) => setPortfolioValue(Number(e.target.value))}
                  type="number"
                  value={portfolioValue}
                />
              </div>

              {/* Lookback Days with Slider */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs">Период анализа</span>
                  <span className="text-muted-foreground text-xs">
                    {lookbackDays} дней
                  </span>
                </div>
                <Slider
                  max={730}
                  min={30}
                  onValueChange={(v) => setLookbackDays(v[0])}
                  step={30}
                  value={[lookbackDays]}
                />
              </div>

              {/* Submit Button */}
              <Button
                className="w-full"
                disabled={loading || symbols.length < 2}
                onClick={handleOptimize}
              >
                {loading ? (
                  <>
                    <Spinner className="mr-2" />
                    Оптимизация...
                  </>
                ) : (
                  "Оптимизировать"
                )}
              </Button>

              {/* Error */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircleIcon className="size-4" />
                  <AlertTitle>Ошибка</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </TerminalPanel>

            {/* Results Panel */}
            {renderResultsPanel()}
          </div>
        </TabsContent>

        {/* Efficient Frontier Tab */}
        <TabsContent className="mt-4" value="frontier">
          <EfficientFrontierChart
            currentPortfolio={result}
            data={efficientFrontier}
            loading={frontierLoading}
          />
        </TabsContent>
      </Tabs>

      {/* Metrics */}
      {result && (
        <StatRow>
          <StatItem
            change={{
              value: result.expected_return * 100,
              isPositive: result.expected_return > 0,
            }}
            label="Expected Return"
            value={`${(result.expected_return * 100).toFixed(2)}%`}
          />
          <StatItem
            label="Volatility"
            value={`${(result.volatility * 100).toFixed(2)}%`}
          />
          <StatItem
            label="Sharpe Ratio"
            value={result.sharpe_ratio.toFixed(2)}
          />
          <StatItem
            label="Leftover Cash"
            value={`$${result.leftover?.toFixed(2) || "0.00"}`}
          />
        </StatRow>
      )}

      {/* Weights Table */}
      {result && (
        <div className="grid gap-4 lg:grid-cols-2">
          <WeightsTable
            allocation={result.discrete_allocation}
            portfolioValue={portfolioValue}
            weights={result.weights}
          />

          {/* Generate Code Panel */}
          <TerminalPanel
            action={
              <div className="flex gap-1">
                <Button onClick={handleGenerateCode} size="xs" variant="ghost">
                  <CodeIcon className="size-3" />
                  Generate
                </Button>
                {generatedCode && (
                  <Button onClick={handleCopyCode} size="xs" variant="ghost">
                    <CopyIcon className="size-3" />
                    Copy
                  </Button>
                )}
              </div>
            }
            title="Lean Code"
          >
            {generatedCode ? (
              <pre className="max-h-80 overflow-auto bg-muted p-2 font-mono text-xs">
                {generatedCode}
              </pre>
            ) : (
              <div className="flex h-40 items-center justify-center text-muted-foreground text-xs">
                Нажмите Generate для создания кода
              </div>
            )}
          </TerminalPanel>
        </div>
      )}
    </PageLayout>
  );
}
