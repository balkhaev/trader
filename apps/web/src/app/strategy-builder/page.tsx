"use client";

import {
  ArrowDown,
  ArrowUp,
  Code,
  Copy,
  Plus,
  Save,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import { Textarea } from "@/components/ui/textarea";
import {
  type IndicatorCondition,
  type StrategyCondition,
  type StrategyConfig,
  type StrategyRule,
  useCreateStrategy,
  useGenerateCode,
  useStrategies,
} from "@/hooks/use-strategy";

const INDICATORS = [
  { id: "rsi", name: "RSI", parameters: ["value"], defaultPeriod: 14 },
  {
    id: "macd",
    name: "MACD",
    parameters: ["value", "signal", "histogram"],
    defaultPeriod: 12,
  },
  {
    id: "bollinger",
    name: "Bollinger Bands",
    parameters: ["upper", "middle", "lower"],
    defaultPeriod: 20,
  },
  { id: "sma", name: "SMA", parameters: ["value"], defaultPeriod: 20 },
  { id: "ema", name: "EMA", parameters: ["value"], defaultPeriod: 12 },
  { id: "adx", name: "ADX", parameters: ["value"], defaultPeriod: 14 },
  { id: "atr", name: "ATR", parameters: ["value"], defaultPeriod: 14 },
];

const OPERATORS = [
  { id: ">", name: ">" },
  { id: "<", name: "<" },
  { id: ">=", name: ">=" },
  { id: "<=", name: "<=" },
  { id: "==", name: "=" },
  { id: "crosses_above", name: "Crosses Above" },
  { id: "crosses_below", name: "Crosses Below" },
];

const TIMEFRAMES = [
  { id: "1m", name: "1 Minute" },
  { id: "5m", name: "5 Minutes" },
  { id: "15m", name: "15 Minutes" },
  { id: "1h", name: "1 Hour" },
  { id: "4h", name: "4 Hours" },
  { id: "1d", name: "1 Day" },
];

function generateRuleId() {
  return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function ConditionBuilder({
  condition,
  onChange,
  onRemove,
}: {
  condition: StrategyCondition;
  onChange: (condition: StrategyCondition) => void;
  onRemove: () => void;
}) {
  if (condition.type !== "indicator") {
    return null; // For now, only support indicator conditions
  }

  const ind = condition as IndicatorCondition;
  const indicatorInfo = INDICATORS.find((i) => i.id === ind.indicator);

  return (
    <div className="flex items-center gap-2 rounded border border-border/50 bg-muted/30 p-2">
      <Select
        onValueChange={(v) =>
          onChange({
            ...ind,
            indicator: v as IndicatorCondition["indicator"],
            period: INDICATORS.find((i) => i.id === v)?.defaultPeriod ?? 14,
          })
        }
        value={ind.indicator}
      >
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INDICATORS.map((i) => (
            <SelectItem key={i.id} value={i.id}>
              {i.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {indicatorInfo && indicatorInfo.parameters.length > 1 && (
        <Select
          onValueChange={(v) => onChange({ ...ind, parameter: v })}
          value={ind.parameter}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {indicatorInfo.parameters.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <Input
        className="w-16"
        onChange={(e) =>
          onChange({ ...ind, period: Number.parseInt(e.target.value) || 14 })
        }
        placeholder="Period"
        type="number"
        value={ind.period || 14}
      />

      <Select
        onValueChange={(v) =>
          onChange({ ...ind, operator: v as IndicatorCondition["operator"] })
        }
        value={ind.operator}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op.id} value={op.id}>
              {op.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        className="w-20"
        onChange={(e) =>
          onChange({
            ...ind,
            value: Number.parseFloat(e.target.value) || 0,
          })
        }
        placeholder="Value"
        type="number"
        value={ind.value}
      />

      <Button
        className="h-8 w-8 p-0"
        onClick={onRemove}
        size="sm"
        variant="ghost"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function RuleBuilder({
  rule,
  onChange,
  onRemove,
  ruleType,
}: {
  rule: StrategyRule;
  onChange: (rule: StrategyRule) => void;
  onRemove: () => void;
  ruleType: "entry" | "exit";
}) {
  const addCondition = () => {
    const newCondition: IndicatorCondition = {
      type: "indicator",
      indicator: "rsi",
      parameter: "value",
      period: 14,
      operator: "<",
      value: 30,
    };
    onChange({ ...rule, conditions: [...rule.conditions, newCondition] });
  };

  const updateCondition = (index: number, condition: StrategyCondition) => {
    const newConditions = [...rule.conditions];
    newConditions[index] = condition;
    onChange({ ...rule, conditions: newConditions });
  };

  const removeCondition = (index: number) => {
    onChange({
      ...rule,
      conditions: rule.conditions.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input
            className="w-48"
            onChange={(e) => onChange({ ...rule, name: e.target.value })}
            placeholder="Rule name"
            value={rule.name}
          />
          <Badge variant={ruleType === "entry" ? "default" : "secondary"}>
            {ruleType === "entry" ? "Entry" : "Exit"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select
            onValueChange={(v) =>
              onChange({ ...rule, action: v as StrategyRule["action"] })
            }
            value={rule.action}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ruleType === "entry" ? (
                <>
                  <SelectItem value="long">Go Long</SelectItem>
                  <SelectItem value="short">Go Short</SelectItem>
                </>
              ) : (
                <>
                  <SelectItem value="close_long">Close Long</SelectItem>
                  <SelectItem value="close_short">Close Short</SelectItem>
                  <SelectItem value="close_all">Close All</SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          <Button
            className="h-8 w-8 p-0"
            onClick={onRemove}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Conditions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">When</span>
          <Select
            onValueChange={(v) =>
              onChange({ ...rule, conditionLogic: v as "AND" | "OR" })
            }
            value={rule.conditionLogic}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">ALL</SelectItem>
              <SelectItem value="OR">ANY</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-sm">
            of these conditions are met:
          </span>
        </div>

        {rule.conditions.map((condition, index) => (
          <ConditionBuilder
            condition={condition}
            key={`${rule.id}-${index}`}
            onChange={(c) => updateCondition(index, c)}
            onRemove={() => removeCondition(index)}
          />
        ))}

        <Button
          className="w-full"
          onClick={addCondition}
          size="sm"
          variant="outline"
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Condition
        </Button>
      </div>
    </div>
  );
}

export default function StrategyBuilderPage() {
  const { data: strategiesData } = useStrategies();
  const createStrategy = useCreateStrategy();
  const generateCode = useGenerateCode();

  const [activeTab, setActiveTab] = useState("builder");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  // Strategy config state
  const [config, setConfig] = useState<StrategyConfig>({
    name: "My Strategy",
    description: "",
    symbols: ["BTCUSDT"],
    timeframe: "1h",
    entryRules: [],
    exitRules: [],
    positionSizePercent: 10,
    maxPositions: 3,
    defaultStopLossPercent: 5,
    defaultTakeProfitPercent: 10,
  });

  const [symbolInput, setSymbolInput] = useState("");

  const addSymbol = () => {
    if (symbolInput && !config.symbols.includes(symbolInput.toUpperCase())) {
      setConfig({
        ...config,
        symbols: [...config.symbols, symbolInput.toUpperCase()],
      });
      setSymbolInput("");
    }
  };

  const removeSymbol = (symbol: string) => {
    setConfig({
      ...config,
      symbols: config.symbols.filter((s) => s !== symbol),
    });
  };

  const addEntryRule = () => {
    const newRule: StrategyRule = {
      id: generateRuleId(),
      name: `Entry Rule ${config.entryRules.length + 1}`,
      conditions: [],
      conditionLogic: "AND",
      action: "long",
      priority: config.entryRules.length,
    };
    setConfig({ ...config, entryRules: [...config.entryRules, newRule] });
  };

  const addExitRule = () => {
    const newRule: StrategyRule = {
      id: generateRuleId(),
      name: `Exit Rule ${config.exitRules.length + 1}`,
      conditions: [],
      conditionLogic: "AND",
      action: "close_all",
      priority: config.exitRules.length,
    };
    setConfig({ ...config, exitRules: [...config.exitRules, newRule] });
  };

  const handleGenerateCode = async () => {
    try {
      const result = await generateCode.mutateAsync(config);
      setGeneratedCode(result.code);
      setActiveTab("code");
      toast.success("Code generated successfully");
    } catch {
      toast.error("Failed to generate code");
    }
  };

  const handleSave = async () => {
    try {
      await createStrategy.mutateAsync(config);
      toast.success("Strategy saved successfully");
    } catch {
      toast.error("Failed to save strategy");
    }
  };

  const copyCode = () => {
    if (generatedCode) {
      navigator.clipboard.writeText(generatedCode);
      toast.success("Code copied to clipboard");
    }
  };

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-2">
          <Button
            disabled={generateCode.isPending}
            onClick={handleGenerateCode}
            size="sm"
            variant="outline"
          >
            <Code className="mr-1 h-3 w-3" />
            Generate Code
          </Button>
          <Button
            disabled={createStrategy.isPending}
            onClick={handleSave}
            size="sm"
          >
            <Save className="mr-1 h-3 w-3" />
            Save Strategy
          </Button>
        </div>
      }
      subtitle="Build trading strategies visually and export to Lean"
      title="Strategy Builder"
    >
      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="code">Generated Code</TabsTrigger>
          <TabsTrigger value="saved">
            Saved ({strategiesData?.strategies?.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent className="mt-4" value="builder">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Strategy Info */}
            <div className="space-y-4">
              <TerminalPanel title="Strategy Info">
                <div className="space-y-3 p-3">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      onChange={(e) =>
                        setConfig({ ...config, name: e.target.value })
                      }
                      placeholder="Strategy name"
                      value={config.name}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Textarea
                      onChange={(e) =>
                        setConfig({ ...config, description: e.target.value })
                      }
                      placeholder="Describe your strategy..."
                      rows={2}
                      value={config.description || ""}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Timeframe</Label>
                    <Select
                      onValueChange={(v) =>
                        setConfig({
                          ...config,
                          timeframe: v as StrategyConfig["timeframe"],
                        })
                      }
                      value={config.timeframe}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEFRAMES.map((tf) => (
                          <SelectItem key={tf.id} value={tf.id}>
                            {tf.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TerminalPanel>

              <TerminalPanel title="Symbols">
                <div className="space-y-3 p-3">
                  <div className="flex gap-2">
                    <Input
                      onChange={(e) => setSymbolInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addSymbol()}
                      placeholder="Add symbol..."
                      value={symbolInput}
                    />
                    <Button onClick={addSymbol} size="sm">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {config.symbols.map((symbol) => (
                      <Badge
                        className="cursor-pointer"
                        key={symbol}
                        onClick={() => removeSymbol(symbol)}
                        variant="secondary"
                      >
                        {symbol}
                        <X className="ml-1 h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </TerminalPanel>
            </div>

            {/* Entry Rules */}
            <div className="space-y-4 lg:col-span-2">
              <TerminalPanel
                subtitle={`${config.entryRules.length} rules`}
                title="Entry Rules"
              >
                <div className="space-y-3 p-3">
                  {config.entryRules.map((rule, index) => (
                    <RuleBuilder
                      key={rule.id}
                      onChange={(updatedRule) => {
                        const newRules = [...config.entryRules];
                        newRules[index] = updatedRule;
                        setConfig({ ...config, entryRules: newRules });
                      }}
                      onRemove={() => {
                        setConfig({
                          ...config,
                          entryRules: config.entryRules.filter(
                            (_, i) => i !== index
                          ),
                        });
                      }}
                      rule={rule}
                      ruleType="entry"
                    />
                  ))}
                  <Button
                    className="w-full"
                    onClick={addEntryRule}
                    variant="outline"
                  >
                    <ArrowUp className="mr-1 h-4 w-4 text-green-500" />
                    Add Entry Rule
                  </Button>
                </div>
              </TerminalPanel>

              <TerminalPanel
                subtitle={`${config.exitRules.length} rules`}
                title="Exit Rules"
              >
                <div className="space-y-3 p-3">
                  {config.exitRules.map((rule, index) => (
                    <RuleBuilder
                      key={rule.id}
                      onChange={(updatedRule) => {
                        const newRules = [...config.exitRules];
                        newRules[index] = updatedRule;
                        setConfig({ ...config, exitRules: newRules });
                      }}
                      onRemove={() => {
                        setConfig({
                          ...config,
                          exitRules: config.exitRules.filter(
                            (_, i) => i !== index
                          ),
                        });
                      }}
                      rule={rule}
                      ruleType="exit"
                    />
                  ))}
                  <Button
                    className="w-full"
                    onClick={addExitRule}
                    variant="outline"
                  >
                    <ArrowDown className="mr-1 h-4 w-4 text-red-500" />
                    Add Exit Rule
                  </Button>
                </div>
              </TerminalPanel>
            </div>
          </div>
        </TabsContent>

        <TabsContent className="mt-4" value="settings">
          <div className="grid gap-4 lg:grid-cols-2">
            <TerminalPanel title="Position Sizing">
              <div className="space-y-4 p-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Position Size (%)</Label>
                    <span className="font-mono text-sm">
                      {config.positionSizePercent}%
                    </span>
                  </div>
                  <Slider
                    max={100}
                    min={1}
                    onValueChange={(v) =>
                      setConfig({ ...config, positionSizePercent: v[0] })
                    }
                    step={1}
                    value={[config.positionSizePercent]}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max Positions</Label>
                  <Input
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        maxPositions: Number.parseInt(e.target.value) || 1,
                      })
                    }
                    type="number"
                    value={config.maxPositions}
                  />
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Risk Management">
              <div className="space-y-4 p-3">
                <div className="flex items-center justify-between">
                  <Label>Use Stop Loss</Label>
                  <Switch
                    checked={config.defaultStopLossPercent !== undefined}
                    onCheckedChange={(v) =>
                      setConfig({
                        ...config,
                        defaultStopLossPercent: v ? 5 : undefined,
                      })
                    }
                  />
                </div>
                {config.defaultStopLossPercent !== undefined && (
                  <div className="space-y-1.5">
                    <Label>Stop Loss (%)</Label>
                    <Input
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          defaultStopLossPercent:
                            Number.parseFloat(e.target.value) || 5,
                        })
                      }
                      type="number"
                      value={config.defaultStopLossPercent}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <Label>Use Take Profit</Label>
                  <Switch
                    checked={config.defaultTakeProfitPercent !== undefined}
                    onCheckedChange={(v) =>
                      setConfig({
                        ...config,
                        defaultTakeProfitPercent: v ? 10 : undefined,
                      })
                    }
                  />
                </div>
                {config.defaultTakeProfitPercent !== undefined && (
                  <div className="space-y-1.5">
                    <Label>Take Profit (%)</Label>
                    <Input
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          defaultTakeProfitPercent:
                            Number.parseFloat(e.target.value) || 10,
                        })
                      }
                      type="number"
                      value={config.defaultTakeProfitPercent}
                    />
                  </div>
                )}
              </div>
            </TerminalPanel>
          </div>
        </TabsContent>

        <TabsContent className="mt-4" value="code">
          <TerminalPanel
            actions={
              generatedCode ? (
                <Button onClick={copyCode} size="sm" variant="outline">
                  <Copy className="mr-1 h-3 w-3" />
                  Copy
                </Button>
              ) : null
            }
            title="Generated Lean Code"
          >
            {generatedCode ? (
              <pre className="max-h-[600px] overflow-auto p-4 font-mono text-sm">
                <code>{generatedCode}</code>
              </pre>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Code className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No code generated yet</p>
                <p className="text-xs">
                  Build your strategy and click "Generate Code"
                </p>
              </div>
            )}
          </TerminalPanel>
        </TabsContent>

        <TabsContent className="mt-4" value="saved">
          <TerminalPanel title="Saved Strategies">
            {!strategiesData?.strategies ||
            strategiesData.strategies.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <Settings className="mb-2 h-8 w-8 opacity-50" />
                <p className="text-sm">No saved strategies</p>
                <p className="text-xs">
                  Create and save a strategy to see it here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {strategiesData.strategies.map((strat) => (
                  <div
                    className="flex items-center justify-between p-3 hover:bg-muted/30"
                    key={strat.id}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{strat.name}</span>
                        {strat.isActive && (
                          <Badge className="bg-green-500/20 text-green-400">
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        {strat.config.symbols.join(", ")} •{" "}
                        {strat.config.timeframe} •{" "}
                        {strat.config.entryRules.length} entry rules
                      </p>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {new Date(strat.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TerminalPanel>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
