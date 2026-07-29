"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Play,
  RadioTower,
  RotateCcw,
  Save,
  ShieldCheck,
  Waves,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageLayout, PageLoading, StatItem, StatRow } from "@/components/layout";
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
  useResetStrategyRuntime,
  useScanStrategy,
  useToggleStrategy,
  useUpdateStrategy,
} from "@/hooks/use-strategy";

function NumberField({
  label,
  value,
  onChange,
  max,
  suffix = "%",
  step = 0.25,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max: number;
  suffix?: string;
  step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          max={max}
          min={0.01}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={value}
        />
        <span className="pointer-events-none absolute top-2.5 right-3 text-muted-foreground text-xs">
          {suffix}
        </span>
      </div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-border/60 border-b py-2 last:border-0">
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground text-xs leading-5">{children}</span>
    </div>
  );
}

export default function StrategyBlueprintPage() {
  const canonical = useCanonicalStrategy();
  const defaults = useDefaultStrategy();
  const update = useUpdateStrategy();
  const toggle = useToggleStrategy();
  const scan = useScanStrategy();
  const resetRuntime = useResetStrategyRuntime();
  const [config, setConfig] = useState<StrategyConfig | null>(null);

  useEffect(() => {
    if (canonical.data) setConfig(canonical.data.config);
  }, [canonical.data]);

  if (canonical.isLoading || !canonical.data || !config) {
    return (
      <PageLayout title="Strategy Blueprint">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const strategy = canonical.data;
  const runtime = strategy.config.runtime;
  const equity = runtime?.equity ?? 0;
  const highWater = runtime?.highWaterEquity ?? equity;
  const drawdown = highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;

  const save = () =>
    update.mutate(
      { strategyId: strategy.id, config },
      {
        onSuccess: () => toast.success("Operational blueprint сохранён"),
        onError: (error) => toast.error(error.message),
      }
    );

  const runScan = (execute: boolean) =>
    scan.mutate(execute, {
      onSuccess: (result) =>
        toast.success(
          result.signals.length
            ? `Сигналов ${result.signals.length}, исполнено ${result.signals.filter((item) => item.executed).length}`
            : "Новых кандидатов нет"
        ),
      onError: (error) => toast.error(error.message),
    });

  return (
    <PageLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => runScan(false)} size="sm" variant="outline">
            <RadioTower className="mr-1 size-3.5" /> Shadow scan
          </Button>
          <Button
            disabled={!strategy.isActive}
            onClick={() => runScan(true)}
            size="sm"
            variant="outline"
          >
            <Play className="mr-1 size-3.5" /> Execute scan
          </Button>
          <Button onClick={save} size="sm">
            <Save className="mr-1 size-3.5" /> Сохранить
          </Button>
        </div>
      }
      subtitle="Сигнальная логика immutable; изменяются только модули и risk envelope"
      title="Consensus WIF + DOT V1"
    >
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80">
        <div className="grid lg:grid-cols-[1fr_auto]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant={strategy.isActive ? "default" : "secondary"}>
                {strategy.isActive ? "ACTIVE" : "PAUSED"}
              </Badge>
              <Badge variant={runtime?.mode === "stopped" ? "destructive" : "outline"}>
                {(runtime?.mode ?? "base").toUpperCase()}
              </Badge>
              <Badge variant="outline">MARKET ONLY</Badge>
              <Badge variant="outline">BINANCE USD-M</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl">
              Параметры входа, стопа и цели зафиксированы исследованием.
            </h2>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              Backend игнорирует попытки изменить signal definition и принимает
              только module enable, cost reserve, gross cap и risk accelerator.
            </p>
          </div>
          <div className="flex items-center gap-5 border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Runtime</div>
              <div className="mt-1 font-mono text-xl">{(runtime?.mode ?? "base").toUpperCase()}</div>
              <div className="text-muted-foreground text-xs">DD {drawdown.toFixed(2)}%</div>
            </div>
            <Switch
              checked={strategy.isActive}
              disabled={toggle.isPending}
              onCheckedChange={() => toggle.mutate(strategy.id)}
            />
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="WIF risk" value={`${config.risk.baseWifRiskPercent}% / ${config.risk.boostWifRiskPercent}%`} />
        <StatItem label="DOT risk" value={`${config.risk.baseDotRiskPercent}% / ${config.risk.boostDotRiskPercent}%`} />
        <StatItem label="Gross cap" value={`${config.execution.maxGrossLeverage}x`} />
        <StatItem label="Cost reserve" value={`${config.execution.roundTurnCostBps} bps`} />
        <StatItem label="Max positions" value="2" />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <TerminalPanel subtitle="Tue / Fri / Sun · 15m long" title="WIF OI Flush Reclaim">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <Waves className="size-5 text-primary" />
              <Switch
                checked={config.wif.enabled}
                onCheckedChange={(enabled) =>
                  setConfig({ ...config, wif: { ...config.wif, enabled } })
                }
              />
            </div>
            <div className="grid md:grid-cols-2">
              <div>
                <Rule>45m move ≤ −2 ATR</Rule>
                <Rule>Volume z ≥ 1</Rule>
                <Rule>Lower wick ≥ 50%</Rule>
                <Rule>Close location ≥ 60%</Rule>
              </div>
              <div>
                <Rule>Taker imbalance ≥ −0.10</Rule>
                <Rule>OI z ≤ −1</Rule>
                <Rule>Strength ≥ 3.5</Rule>
                <Rule>Next closed-bar scan</Rule>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Box icon={ArrowDownRight} label="stop" value="1.25 ATR" />
              <Box icon={ArrowUpRight} label="target" value="5R" />
              <Box icon={Activity} label="exit" value="60m" />
            </div>
          </div>
        </TerminalPanel>

        <TerminalPanel subtitle="Published funding · 15m delay · long" title="DOT Negative Funding Rebound">
          <div className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <CircleDollarSign className="size-5 text-primary" />
              <Switch
                checked={config.dot.enabled}
                onCheckedChange={(enabled) =>
                  setConfig({ ...config, dot: { ...config.dot, enabled } })
                }
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Box icon={CircleDollarSign} label="Mon / Tue" value="≤ −2.25 bps" />
              <Box icon={CircleDollarSign} label="Fri / Sat / Sun" value="≤ −2.50 bps" />
              <Box icon={Activity} label="entry delay" value="15m" />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Box icon={ArrowDownRight} label="stop" value="6 ATR" />
              <Box icon={ArrowUpRight} label="target" value="2R" />
              <Box icon={Activity} label="exit" value="8h" />
            </div>
          </div>
        </TerminalPanel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <TerminalPanel title="Risk Accelerator">
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField label="WIF base" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, baseWifRiskPercent: value } })} value={config.risk.baseWifRiskPercent} />
              <NumberField label="DOT base" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, baseDotRiskPercent: value } })} value={config.risk.baseDotRiskPercent} />
              <NumberField label="WIF boost" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostWifRiskPercent: value } })} value={config.risk.boostWifRiskPercent} />
              <NumberField label="DOT boost" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostDotRiskPercent: value } })} value={config.risk.boostDotRiskPercent} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField label="Boost trigger" max={100} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostTriggerProfitPercent: value } })} value={config.risk.boostTriggerProfitPercent} />
              <NumberField label="De-risk DD" max={49} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, deRiskDrawdownPercent: value } })} value={config.risk.deRiskDrawdownPercent} />
              <NumberField label="Hard stop DD" max={50} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, hardStopDrawdownPercent: value } })} value={config.risk.hardStopDrawdownPercent} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Maximum gross" max={5} onChange={(value) => setConfig({ ...config, execution: { ...config.execution, maxGrossLeverage: value } })} suffix="x" value={config.execution.maxGrossLeverage} />
              <NumberField label="Cost reserve" max={100} onChange={(value) => setConfig({ ...config, execution: { ...config.execution, roundTurnCostBps: value } })} step={1} suffix="bps" value={config.execution.roundTurnCostBps} />
            </div>
          </div>
        </TerminalPanel>

        <div className="space-y-4">
          <TerminalPanel title="Runtime controls">
            <div className="space-y-3 p-4">
              <Button
                className="w-full"
                disabled={!defaults.data}
                onClick={() => defaults.data && setConfig(defaults.data.config)}
                variant="outline"
              >
                <RotateCcw className="mr-1 size-3.5" /> Restore researched defaults
              </Button>
              <Button
                className="w-full"
                disabled={resetRuntime.isPending}
                onClick={() =>
                  resetRuntime.mutate(undefined, {
                    onSuccess: () => toast.success("Runtime reset to BASE"),
                    onError: (error) => toast.error(error.message),
                  })
                }
                variant="destructive"
              >
                Reset sticky hard-stop
              </Button>
              <p className="text-muted-foreground text-xs leading-5">
                Reset разрешён backend только при выключенном execution и отсутствии
                открытых Binance-позиций.
              </p>
            </div>
          </TerminalPanel>
        </div>
      </div>
    </PageLayout>
  );
}

function Box({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <Icon className="mx-auto size-4 text-muted-foreground" />
      <div className="mt-2 font-mono text-sm">{value}</div>
      <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
