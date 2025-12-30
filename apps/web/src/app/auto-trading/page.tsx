"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Play,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type AutoTradingConfig,
  useAutoTradingConfig,
  useAutoTradingLogs,
  useAutoTradingStats,
  useToggleAutoTrading,
  useUpdateAutoTradingConfig,
} from "@/hooks/use-auto-trading";
import { useExchangeAccounts } from "@/hooks/use-exchange";

function ConfigSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border-border/50 border-b pb-4">
      <h3 className="font-medium text-sm">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function LogRow({
  log,
}: {
  log: {
    action: string;
    reason: string;
    createdAt: string;
    details: Record<string, unknown> | null;
  };
}) {
  const actionIcon =
    log.action === "executed" ? (
      <Check className="h-4 w-4 text-green-500" />
    ) : log.action === "skipped" ? (
      <Clock className="h-4 w-4 text-yellow-500" />
    ) : (
      <X className="h-4 w-4 text-red-500" />
    );

  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2 last:border-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 items-center justify-center rounded bg-muted">
          {actionIcon}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Badge
              className="text-[10px]"
              variant={
                log.action === "executed"
                  ? "default"
                  : log.action === "skipped"
                    ? "secondary"
                    : "destructive"
              }
            >
              {log.action.toUpperCase()}
            </Badge>
            {log.details?.symbol && (
              <span className="font-mono text-sm">
                {String(log.details.symbol)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-muted-foreground text-xs">{log.reason}</p>
        </div>
      </div>
      <span className="text-muted-foreground text-xs">
        {new Date(log.createdAt).toLocaleTimeString()}
      </span>
    </div>
  );
}

export default function AutoTradingPage() {
  const { data: config, isLoading: configLoading } = useAutoTradingConfig();
  const { data: stats, isLoading: statsLoading } = useAutoTradingStats();
  const { data: logs } = useAutoTradingLogs(20);
  const { data: accounts } = useExchangeAccounts();
  const updateConfig = useUpdateAutoTradingConfig();
  const toggleAutoTrading = useToggleAutoTrading();

  const [localConfig, setLocalConfig] = useState<Partial<AutoTradingConfig>>(
    {}
  );

  const handleToggle = () => {
    toggleAutoTrading.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(
          data.enabled ? "Auto-trading enabled" : "Auto-trading disabled"
        );
      },
      onError: () => toast.error("Failed to toggle auto-trading"),
    });
  };

  const handleSave = () => {
    updateConfig.mutate(localConfig, {
      onSuccess: () => {
        toast.success("Settings saved");
        setLocalConfig({});
      },
      onError: () => toast.error("Failed to save settings"),
    });
  };

  const getValue = <K extends keyof AutoTradingConfig>(
    key: K
  ): AutoTradingConfig[K] | undefined => {
    return (localConfig[key] ?? config?.[key]) as
      | AutoTradingConfig[K]
      | undefined;
  };

  const setValue = <K extends keyof AutoTradingConfig>(
    key: K,
    value: AutoTradingConfig[K]
  ) => {
    setLocalConfig((prev) => ({ ...prev, [key]: value }));
  };

  const hasChanges = Object.keys(localConfig).length > 0;

  if (configLoading) {
    return (
      <PageLayout title="Auto-Trading">
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button onClick={handleSave} size="sm">
              Save Changes
            </Button>
          )}
          <Button
            disabled={toggleAutoTrading.isPending}
            onClick={handleToggle}
            size="sm"
            variant={config?.enabled ? "destructive" : "default"}
          >
            {config?.enabled ? (
              <>
                <Square className="mr-1 h-3 w-3" />
                Stop
              </>
            ) : (
              <>
                <Play className="mr-1 h-3 w-3" />
                Start
              </>
            )}
          </Button>
        </div>
      }
      subtitle="Automated signal execution with configurable rules"
      title="Auto-Trading"
    >
      {/* Warning Banner */}
      {config?.enabled && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <div className="flex-1">
            <p className="font-medium text-sm text-yellow-500">
              Auto-trading is active
            </p>
            <p className="text-muted-foreground text-xs">
              Signals meeting your criteria will be automatically executed
            </p>
          </div>
          <Badge className="bg-green-500/20 text-green-400" variant="secondary">
            <Zap className="mr-1 h-3 w-3" />
            Live
          </Badge>
        </div>
      )}

      {/* Stats Row */}
      <StatRow>
        <StatItem
          label="Status"
          value={config?.enabled ? "Active" : "Inactive"}
        />
        <StatItem
          label="Today Executed"
          value={statsLoading ? "..." : (stats?.todayExecuted ?? 0)}
        />
        <StatItem
          label="Today Skipped"
          value={statsLoading ? "..." : (stats?.todaySkipped ?? 0)}
        />
        <StatItem
          label="Daily Limit"
          value={`${stats?.todayExecuted ?? 0}/${stats?.maxDailyTrades ?? 10}`}
        />
      </StatRow>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Configuration Panel */}
        <TerminalPanel title="Configuration">
          <div className="space-y-4 p-3">
            {/* Exchange Account */}
            <ConfigSection title="Exchange Account">
              <Select
                onValueChange={(value) =>
                  setValue("exchangeAccountId", value === "none" ? null : value)
                }
                value={getValue("exchangeAccountId") ?? "none"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select exchange account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account selected</SelectItem>
                  {accounts?.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} ({account.exchange})
                      {account.testnet && " [TESTNET]"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigSection>

            {/* Signal Filters */}
            <ConfigSection title="Signal Filters">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Min Signal Strength</Label>
                  <span className="font-mono text-sm">
                    {getValue("minSignalStrength") ?? "75"}%
                  </span>
                </div>
                <Slider
                  max={100}
                  min={0}
                  onValueChange={(v) =>
                    setValue("minSignalStrength", String(v[0]))
                  }
                  step={5}
                  value={[
                    Number.parseFloat(getValue("minSignalStrength") ?? "75"),
                  ]}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Allow Long Positions</Label>
                <Switch
                  checked={getValue("allowLong") ?? true}
                  onCheckedChange={(v) => setValue("allowLong", v)}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label>Allow Short Positions</Label>
                <Switch
                  checked={getValue("allowShort") ?? true}
                  onCheckedChange={(v) => setValue("allowShort", v)}
                />
              </div>
            </ConfigSection>

            {/* Position Sizing */}
            <ConfigSection title="Position Sizing">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Size Type</Label>
                  <Select
                    onValueChange={(v) =>
                      setValue(
                        "positionSizeType",
                        v as "fixed" | "percent" | "risk_based"
                      )
                    }
                    value={getValue("positionSizeType") ?? "fixed"}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed (USD)</SelectItem>
                      <SelectItem value="percent">
                        Percent of Balance
                      </SelectItem>
                      <SelectItem value="risk_based">Risk-Based</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Size Value</Label>
                  <Input
                    onChange={(e) =>
                      setValue("positionSizeValue", e.target.value)
                    }
                    type="number"
                    value={getValue("positionSizeValue") ?? "100"}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Max Position Size (USD)</Label>
                <Input
                  onChange={(e) => setValue("maxPositionSize", e.target.value)}
                  type="number"
                  value={getValue("maxPositionSize") ?? "1000"}
                />
              </div>
            </ConfigSection>

            {/* Risk Management */}
            <ConfigSection title="Risk Management">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between">
                  <Label>Use Stop Loss</Label>
                  <Switch
                    checked={getValue("useStopLoss") ?? true}
                    onCheckedChange={(v) => setValue("useStopLoss", v)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Stop Loss %</Label>
                  <Input
                    disabled={!(getValue("useStopLoss") ?? true)}
                    onChange={(e) =>
                      setValue("defaultStopLossPercent", e.target.value)
                    }
                    type="number"
                    value={getValue("defaultStopLossPercent") ?? "5"}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex items-center justify-between">
                  <Label>Use Take Profit</Label>
                  <Switch
                    checked={getValue("useTakeProfit") ?? true}
                    onCheckedChange={(v) => setValue("useTakeProfit", v)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Take Profit %</Label>
                  <Input
                    disabled={!(getValue("useTakeProfit") ?? true)}
                    onChange={(e) =>
                      setValue("defaultTakeProfitPercent", e.target.value)
                    }
                    type="number"
                    value={getValue("defaultTakeProfitPercent") ?? "10"}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Max Daily Trades</Label>
                  <Input
                    onChange={(e) => setValue("maxDailyTrades", e.target.value)}
                    type="number"
                    value={getValue("maxDailyTrades") ?? "10"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max Daily Loss %</Label>
                  <Input
                    onChange={(e) =>
                      setValue("maxDailyLossPercent", e.target.value)
                    }
                    type="number"
                    value={getValue("maxDailyLossPercent") ?? "5"}
                  />
                </div>
              </div>
            </ConfigSection>
          </div>
        </TerminalPanel>

        {/* Execution Log */}
        <TerminalPanel
          subtitle={`${logs?.logs?.length ?? 0} entries`}
          title="Execution Log"
        >
          {!logs?.logs || logs.logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Bot className="mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">No auto-trades yet</p>
              <p className="text-xs">
                Enable auto-trading to see execution logs
              </p>
            </div>
          ) : (
            <div>
              {logs.logs.map((log) => (
                <LogRow key={log.id} log={log} />
              ))}
            </div>
          )}
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
