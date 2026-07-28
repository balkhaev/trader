"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  LockKeyhole,
  Play,
  RadioTower,
  RotateCcw,
  Save,
  ShieldCheck,
  Waves,
  Zap,
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
  useScanStrategy,
  useToggleStrategy,
  useUpdateStrategy,
} from "@/hooks/use-strategy";

function NumberField({
  label,
  value,
  onChange,
  suffix = "%",
  step = 0.25,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  step?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          max={max}
          min={0}
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
    <div className="flex items-start gap-2 border-border/60 border-b py-2 last:border-0">
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground text-xs leading-5">{children}</span>
    </div>
  );
}

function ModuleCard({
  title,
  subtitle,
  icon: Icon,
  enabled,
  onEnabled,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  enabled: boolean;
  onEnabled: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <TerminalPanel subtitle={subtitle} title={title}>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="size-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-sm">{title}</p>
              <p className="text-muted-foreground text-xs">Fixed research route</p>
            </div>
          </div>
          <Switch checked={enabled} onCheckedChange={onEnabled} />
        </div>
        {children}
      </div>
    </TerminalPanel>
  );
}

export default function StrategyBlueprintPage() {
  const canonical = useCanonicalStrategy();
  const defaults = useDefaultStrategy();
  const update = useUpdateStrategy();
  const toggle = useToggleStrategy();
  const scan = useScanStrategy();
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
  const initial = runtime?.initialEquity ?? equity;
  const highWater = runtime?.highWaterEquity ?? equity;
  const returnPercent = initial > 0 ? (equity / initial - 1) * 100 : 0;
  const drawdown = highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;
  const mode = (runtime?.mode ?? "base").toUpperCase();

  const save = async () => {
    try {
      await update.mutateAsync({ strategyId: strategy.id, config });
      toast.success("Strategy blueprint сохранён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сохранения");
    }
  };

  const runScan = async (execute: boolean) => {
    try {
      const result = await scan.mutateAsync(execute);
      if (!result.scanned) {
        toast.error(result.reason ?? "Scan skipped");
        return;
      }
      toast.success(
        result.signals.length
          ? `Найдено ${result.signals.length}; исполнено ${result.signals.filter((item) => item.executed).length}`
          : "Новых кандидатов нет"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scan failed");
    }
  };

  return (
    <PageLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <Button disabled={scan.isPending} onClick={() => runScan(false)} size="sm" variant="outline">
            <RadioTower className="mr-1 size-3.5" /> Shadow scan
          </Button>
          <Button disabled={scan.isPending || !strategy.isActive} onClick={() => runScan(true)} size="sm" variant="outline">
            <Play className="mr-1 size-3.5" /> Execute scan
          </Button>
          <Button disabled={update.isPending} onClick={save} size="sm">
            <Save className="mr-1 size-3.5" /> Сохранить
          </Button>
        </div>
      }
      subtitle="Одна детерминированная стратегия вместо универсального конструктора"
      title="Consensus WIF + DOT V1"
    >
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80">
        <div className="grid lg:grid-cols-[1fr_auto]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant={strategy.isActive ? "default" : "secondary"}>{strategy.isActive ? "ACTIVE" : "PAUSED"}</Badge>
              <Badge variant={runtime?.mode === "stopped" ? "destructive" : "outline"}>{mode}</Badge>
              <Badge variant="outline">NO LLM</Badge>
              <Badge variant="outline">BINANCE USD-M</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl tracking-tight">
              Сигнальная логика зафиксирована; редактируются только операционные параметры риска.
            </h2>
            <p className="mt-2 max-w-4xl text-muted-foreground text-sm leading-6">
              WIF ищет OI-flush reclaim, DOT — возврат после уже опубликованного отрицательного funding. Любое изменение сохраняется как явный blueprint, а не как свободная комбинация индикаторов.
            </p>
          </div>
          <div className="flex min-w-64 items-center justify-between gap-5 border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Runtime</div>
              <div className="mt-1 font-mono text-xl">{mode}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">Return {returnPercent.toFixed(2)}% · DD {drawdown.toFixed(2)}%</div>
            </div>
            <Switch checked={strategy.isActive} disabled={toggle.isPending} onCheckedChange={() => toggle.mutate(strategy.id)} />
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="Mode" value={mode} />
        <StatItem label="WIF base / boost" value={`${config.risk.baseWifRiskPercent}% / ${config.risk.boostWifRiskPercent}%`} />
        <StatItem label="DOT base / boost" value={`${config.risk.baseDotRiskPercent}% / ${config.risk.boostDotRiskPercent}%`} />
        <StatItem label="Gross cap" value={`${config.execution.maxGrossLeverage}x`} />
        <StatItem label="Cost reserve" value={`${config.execution.roundTurnCostBps} bps`} />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <ModuleCard
          enabled={config.wif.enabled}
          icon={Waves}
          onEnabled={(enabled) => setConfig({ ...config, wif: { ...config.wif, enabled } })}
          subtitle="Tue / Fri / Sun · 15m · long"
          title="WIF OI Flush Reclaim"
        >
          <div className="grid gap-x-5 md:grid-cols-2">
            <div>
              <Rule>45m move ≤ {config.wif.move45mAtrMax} ATR</Rule>
              <Rule>Volume z ≥ {config.wif.volumeZMin}</Rule>
              <Rule>Lower wick ≥ {(config.wif.lowerWickRatioMin * 100).toFixed(0)}%</Rule>
              <Rule>Close location ≥ {(config.wif.closeLocationMin * 100).toFixed(0)}%</Rule>
            </div>
            <div>
              <Rule>Taker imbalance ≥ {config.wif.takerImbalanceMin}</Rule>
              <Rule>OI z ≤ {config.wif.oiZMax}</Rule>
              <Rule>Strength ≥ {config.wif.strengthMin}</Rule>
              <Rule>Next 15m open entry</Rule>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border bg-background/40 p-3"><ArrowDownRight className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.wif.stopAtr} ATR</div><div className="text-[9px] text-muted-foreground uppercase">stop</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><ArrowUpRight className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.wif.targetR}R</div><div className="text-[9px] text-muted-foreground uppercase">target</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><Activity className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.wif.maxHoldMinutes}m</div><div className="text-[9px] text-muted-foreground uppercase">exit</div></div>
          </div>
        </ModuleCard>

        <ModuleCard
          enabled={config.dot.enabled}
          icon={CircleDollarSign}
          onEnabled={(enabled) => setConfig({ ...config, dot: { ...config.dot, enabled } })}
          subtitle="Known funding only · 15m delay · long"
          title="DOT Negative Funding Rebound"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-background/40 p-3"><div className="text-[9px] text-muted-foreground uppercase">Mon / Tue</div><div className="mt-2 font-mono text-lg">≤ −2.25 bps</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><div className="text-[9px] text-muted-foreground uppercase">Fri / Sat / Sun</div><div className="mt-2 font-mono text-lg">≤ −2.50 bps</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><div className="text-[9px] text-muted-foreground uppercase">Entry delay</div><div className="mt-2 font-mono text-lg">{config.dot.entryDelayMinutes}m</div></div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border bg-background/40 p-3"><ArrowDownRight className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.dot.stopAtr} ATR</div><div className="text-[9px] text-muted-foreground uppercase">stop</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><ArrowUpRight className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.dot.targetR}R</div><div className="text-[9px] text-muted-foreground uppercase">target</div></div>
            <div className="rounded-xl border bg-background/40 p-3"><Activity className="mx-auto size-4 text-muted-foreground" /><div className="mt-2 font-mono text-lg">{config.dot.maxHoldMinutes / 60}h</div><div className="text-[9px] text-muted-foreground uppercase">exit</div></div>
          </div>
        </ModuleCard>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <TerminalPanel subtitle="Закрытая equity управляет режимом" title="Risk Accelerator">
          <div className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <NumberField label="WIF base" max={15} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, baseWifRiskPercent: value } })} value={config.risk.baseWifRiskPercent} />
              <NumberField label="DOT base" max={15} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, baseDotRiskPercent: value } })} value={config.risk.baseDotRiskPercent} />
              <NumberField label="WIF boost" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostWifRiskPercent: value } })} value={config.risk.boostWifRiskPercent} />
              <NumberField label="DOT boost" max={20} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostDotRiskPercent: value } })} value={config.risk.boostDotRiskPercent} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberField label="Boost trigger" max={100} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, boostTriggerProfitPercent: value } })} value={config.risk.boostTriggerProfitPercent} />
              <NumberField label="De-risk DD" max={50} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, deRiskDrawdownPercent: value } })} value={config.risk.deRiskDrawdownPercent} />
              <NumberField label="Hard stop DD" max={50} onChange={(value) => setConfig({ ...config, risk: { ...config.risk, hardStopDrawdownPercent: value } })} value={config.risk.hardStopDrawdownPercent} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField label="Maximum gross" max={10} onChange={(value) => setConfig({ ...config, execution: { ...config.execution, maxGrossLeverage: value } })} suffix="x" value={config.execution.maxGrossLeverage} />
              <NumberField label="Cost reserve" max={100} onChange={(value) => setConfig({ ...config, execution: { ...config.execution, roundTurnCostBps: value } })} step={1} suffix="bps" value={config.execution.roundTurnCostBps} />
            </div>
          </div>
        </TerminalPanel>

        <div className="space-y-4">
          <TerminalPanel title="Execution contract">
            <div className="p-4">
              <Rule>Binance USD-M perpetual only.</Rule>
              <Rule>Maximum {config.execution.maxPositions} simultaneous positions.</Rule>
              <Rule>Risk-based quantity with 20 bps reserve.</Rule>
              <Rule>Absolute STOP_MARKET and TAKE_PROFIT_MARKET protection.</Rule>
              <Rule>Emergency flatten if protection cannot be placed.</Rule>
              <Rule>Scheduler remains explicit opt-in.</Rule>
            </div>
          </TerminalPanel>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!defaults.data}
              onClick={() => {
                if (!defaults.data) return;
                setConfig(defaults.data.config);
                toast.info("Researched defaults restored locally");
              }}
              variant="outline"
            >
              <RotateCcw className="mr-1 size-3.5" /> Defaults
            </Button>
            <Button className="flex-1" onClick={save}>
              <LockKeyhole className="mr-1 size-3.5" /> Save blueprint
            </Button>
          </div>
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-yellow-500" />
              <p className="text-muted-foreground text-xs leading-5">
                Изменение риска не создаёт live-допуск. Forward gate, Binance testnet и фактические costs обязательны; исторические 100% остаются upside, а не гарантией.
              </p>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
