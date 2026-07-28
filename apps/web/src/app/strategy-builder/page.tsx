"use client";

import { Activity, Play, RotateCcw, Save, Shield, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLayout, PageLoading } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type StrategyConfig,
  useCanonicalStrategy,
  useDefaultStrategy,
  useScanStrategy,
  useToggleStrategy,
  useUpdateStrategy,
} from "@/hooks/use-strategy";

function NumberField({
  label,
  value,
  onChange,
  step = 0.25,
  suffix = "%",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={value}
        />
        {suffix && (
          <span className="absolute top-2 right-3 text-muted-foreground text-xs">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default function StrategyBuilderPage() {
  const canonical = useCanonicalStrategy();
  const defaults = useDefaultStrategy();
  const update = useUpdateStrategy();
  const toggle = useToggleStrategy();
  const scan = useScanStrategy();
  const [config, setConfig] = useState<StrategyConfig | null>(null);

  useEffect(() => {
    if (canonical.data) setConfig(canonical.data.config);
  }, [canonical.data]);

  if (canonical.isLoading || !config) {
    return (
      <PageLayout title="Consensus Strategy">
        <PageLoading />
      </PageLayout>
    );
  }

  const save = async () => {
    await update.mutateAsync({ strategyId: canonical.data.id, config });
    toast.success("Стратегия сохранена");
  };

  const runScan = async (execute: boolean) => {
    try {
      const result = await scan.mutateAsync(execute);
      if (!result.scanned) {
        toast.error(result.reason || "Сканирование не выполнено");
        return;
      }
      const executed = result.signals.filter((item) => item.executed).length;
      toast.success(
        result.signals.length === 0
          ? "Новых WIF/DOT сигналов нет"
          : `Сигналов: ${result.signals.length}, исполнено: ${executed}`
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка сканирования"
      );
    }
  };

  const runtime = canonical.data.config.runtime;
  const active = canonical.data.isActive;

  return (
    <PageLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runScan(false)} size="sm" variant="outline">
            <Activity className="mr-1 size-3" /> Shadow scan
          </Button>
          <Button
            disabled={!active}
            onClick={() => runScan(true)}
            size="sm"
            variant="outline"
          >
            <Play className="mr-1 size-3" /> Scan & execute
          </Button>
          <Button onClick={save} size="sm">
            <Save className="mr-1 size-3" /> Save
          </Button>
        </div>
      }
      subtitle="Deterministic WIF OI-flush + DOT negative-funding rebound"
      title="Consensus WIF + DOT"
    >
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-4">
          <TerminalPanel title="Risk Accelerator">
            <div className="space-y-4 p-3">
              <div className="flex items-center justify-between rounded border border-border/50 p-3">
                <div>
                  <p className="font-medium text-sm">Strategy runtime</p>
                  <p className="text-muted-foreground text-xs">
                    Base risk → boost after +15% high-water → automatic de-risk.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      runtime?.mode === "stopped" ? "destructive" : "secondary"
                    }
                  >
                    {runtime?.mode ?? "base"}
                  </Badge>
                  <Switch
                    checked={active}
                    onCheckedChange={() => toggle.mutate(canonical.data.id)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label="WIF base stop-risk"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, baseWifRiskPercent: value },
                    })
                  }
                  value={config.risk.baseWifRiskPercent}
                />
                <NumberField
                  label="DOT base stop-risk"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, baseDotRiskPercent: value },
                    })
                  }
                  value={config.risk.baseDotRiskPercent}
                />
                <NumberField
                  label="WIF boost stop-risk"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, boostWifRiskPercent: value },
                    })
                  }
                  value={config.risk.boostWifRiskPercent}
                />
                <NumberField
                  label="DOT boost stop-risk"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, boostDotRiskPercent: value },
                    })
                  }
                  value={config.risk.boostDotRiskPercent}
                />
                <NumberField
                  label="Boost after profit"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: {
                        ...config.risk,
                        boostTriggerProfitPercent: value,
                      },
                    })
                  }
                  value={config.risk.boostTriggerProfitPercent}
                />
                <NumberField
                  label="De-risk drawdown"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, deRiskDrawdownPercent: value },
                    })
                  }
                  value={config.risk.deRiskDrawdownPercent}
                />
                <NumberField
                  label="Hard stop drawdown"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, hardStopDrawdownPercent: value },
                    })
                  }
                  value={config.risk.hardStopDrawdownPercent}
                />
                <NumberField
                  label="Maximum gross leverage"
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      execution: {
                        ...config.execution,
                        maxGrossLeverage: value,
                      },
                    })
                  }
                  suffix="x"
                  value={config.execution.maxGrossLeverage}
                />
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Execution">
            <div className="grid gap-3 p-3 sm:grid-cols-3">
              <NumberField
                label="Round-turn model"
                onChange={(value) =>
                  setConfig({
                    ...config,
                    execution: { ...config.execution, roundTurnCostBps: value },
                  })
                }
                step={1}
                suffix="bps"
                value={config.execution.roundTurnCostBps}
              />
              <div className="space-y-1.5">
                <Label>Venue</Label>
                <Input disabled value="Binance USD-M" />
              </div>
              <div className="space-y-1.5">
                <Label>Maximum positions</Label>
                <Input disabled value={config.execution.maxPositions} />
              </div>
            </div>
          </TerminalPanel>
        </div>

        <div className="space-y-4">
          <TerminalPanel subtitle="15m long-only" title="WIFUSDT OI Flush">
            <div className="space-y-3 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Enabled</span>
                <Switch
                  checked={config.wif.enabled}
                  onCheckedChange={(enabled) =>
                    setConfig({ ...config, wif: { ...config.wif, enabled } })
                  }
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Tuesday / Friday / Sunday. 45m fall ≤ −2 ATR, volume z ≥ 1,
                lower-wick reclaim, taker imbalance ≥ −0.10, OI z ≤ −1, strength
                ≥ 3.5.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Badge variant="outline">Stop {config.wif.stopAtr} ATR</Badge>
                <Badge variant="outline">Target {config.wif.targetR}R</Badge>
                <Badge variant="outline">
                  Hold {config.wif.maxHoldMinutes}m
                </Badge>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel
            subtitle="Known funding only"
            title="DOTUSDT Funding Rebound"
          >
            <div className="space-y-3 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Enabled</span>
                <Switch
                  checked={config.dot.enabled}
                  onCheckedChange={(enabled) =>
                    setConfig({ ...config, dot: { ...config.dot, enabled } })
                  }
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Long 15 minutes after known funding. Mon/Tue ≤ −2.25 bps;
                Fri/Sat/Sun ≤ −2.50 bps; Wed/Thu skipped.
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Badge variant="outline">Stop {config.dot.stopAtr} ATR</Badge>
                <Badge variant="outline">Target {config.dot.targetR}R</Badge>
                <Badge variant="outline">
                  Hold {config.dot.maxHoldMinutes / 60}h
                </Badge>
              </div>
            </div>
          </TerminalPanel>

          <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3">
            <div className="flex gap-2">
              <Shield className="mt-0.5 size-4 text-yellow-500" />
              <div>
                <p className="font-medium text-sm">Live safety</p>
                <p className="text-muted-foreground text-xs">
                  Scheduler is off unless STRATEGY_SCHEDULER_ENABLED=true. Use a
                  Binance testnet account first. Boost risk activates only after
                  closed equity reaches a new high-water above +15%.
                </p>
              </div>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => {
              if (defaults.data) {
                setConfig(defaults.data.config);
                toast.info("Заводские параметры восстановлены локально");
              }
            }}
            variant="outline"
          >
            <RotateCcw className="mr-1 size-3" /> Restore researched defaults
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
