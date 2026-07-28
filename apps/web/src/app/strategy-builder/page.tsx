"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Gauge,
  LockKeyhole,
  Play,
  RadioTower,
  RotateCcw,
  Save,
  ShieldCheck,
  Target,
  Waves,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  PageLayout,
  PageLoading,
  StatItem,
  StatRow,
} from "@/components/layout";
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
  description,
  value,
  onChange,
  step = 0.25,
  suffix = "%",
  min = 0,
  max,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-end justify-between gap-2">
        <Label>{label}</Label>
        {description ? (
          <span className="text-[10px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <Input
          max={max}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={step}
          type="number"
          value={value}
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-2.5 right-3 text-muted-foreground text-xs">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Rule({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-border/60 border-b py-2 last:border-0">
      <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="text-muted-foreground text-xs leading-5">
        {children}
      </span>
    </div>
  );
}

function DayBadge({ day, active }: { day: string; active: boolean }) {
  return (
    <div
      className={`rounded-lg border px-2 py-2 text-center font-mono text-[10px] uppercase ${
        active
          ? "border-primary/35 bg-primary/10 text-primary"
          : "border-border/70 bg-background/30 text-muted-foreground/50"
      }`}
    >
      {day}
    </div>
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
  const initialEquity = runtime?.initialEquity ?? equity;
  const highWater = runtime?.highWaterEquity ?? equity;
  const returnPercent =
    initialEquity > 0 ? (equity / initialEquity - 1) * 100 : 0;
  const drawdownPercent =
    highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;
  const activeRisk =
    runtime?.mode === "boost"
      ? "BOOST"
      : runtime?.mode === "stopped"
        ? "STOPPED"
        : "BASE";

  const save = async () => {
    await update.mutateAsync({ strategyId: strategy.id, config });
    toast.success("Конфигурация стратегии сохранена");
  };

  const runScan = async (execute: boolean) => {
    try {
      const result = await scan.mutateAsync(execute);
      if (!result.scanned) {
        toast.error(result.reason ?? "Сканирование не выполнено");
        return;
      }
      const executed = result.signals.filter((item) => item.executed).length;
      toast.success(
        result.signals.length
          ? `Сигналов ${result.signals.length}, исполнено ${executed}`
          : "Новых кандидатов нет"
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка сканирования"
      );
    }
  };

  return (
    <PageLayout
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={scan.isPending}
            onClick={() => runScan(false)}
            size="sm"
            variant="outline"
          >
            <RadioTower className="mr-1 size-3.5" /> Shadow scan
          </Button>
          <Button
            disabled={scan.isPending || !strategy.isActive}
            onClick={() => runScan(true)}
            size="sm"
            variant="outline"
          >
            <Play className="mr-1 size-3.5" /> Execute scan
          </Button>
          <Button disabled={update.isPending} onClick={save} size="sm">
            <Save className="mr-1 size-3.5" /> Сохранить
          </Button>
        </div>
      }
      subtitle="Фиксированный blueprint стратегии: сигналы заблокированы, риск и исполнение контролируются явно"
      title="Consensus WIF + DOT V1"
    >
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80">
        <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={strategy.isActive ? "default" : "secondary"}>
                {strategy.isActive ? "ACTIVE" : "PAUSED"}
              </Badge>
              <Badge
                variant={
                  runtime?.mode === "stopped" ? "destructive" : "outline"
                }
              >
                {activeRisk}
              </Badge>
              <Badge variant="outline">DETERMINISTIC</Badge>
              <Badge variant="outline">NO LLM</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl tracking-tight">
              Торговая логика не собирается из индикаторов — она зафиксирована
              исследованием.
            </h2>
            <p className="mt-2 max-w-4xl text-muted-foreground text-sm leading-6">
              Интерфейс позволяет управлять включением модулей и
              риск-ускорителем, но не превращает стратегию обратно в
              универсальный конструктор. Это снижает риск случайной подгонки и
              несогласованных live-настроек.
            </p>
          </div>
          <div className="flex min-w-64 items-center justify-between gap-4 border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Runtime
              </div>
              <div className="mt-1 font-mono text-lg">{activeRisk}</div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">
                Return {returnPercent.toFixed(2)}% · DD{" "}
                {drawdownPercent.toFixed(2)}%
              </div>
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
        <StatItem label="Mode" value={activeRisk} />
        <StatItem
          label="WIF base / boost"
          value={`${config.risk.baseWifRiskPercent}% / ${config.risk.boostWifRiskPercent}%`}
        />
        <StatItem
          label="DOT base / boost"
          value={`${config.risk.baseDotRiskPercent}% / ${config.risk.boostDotRiskPercent}%`}
        />
        <StatItem
          label="Gross cap"
          value={`${config.execution.maxGrossLeverage}x`}
        />
        <StatItem
          label="Cost reserve"
          value={`${config.execution.roundTurnCostBps} bps`}
        />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4">
          <TerminalPanel
            subtitle="Consensus weekdays · 15m · long"
            title="WIFUSDT — OI Flush Reclaim"
          >
            <div className="space-y-5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10">
                    <Waves className="size-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      Ликвидационный отскок с OI flush
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Вход на open следующей 15m свечи
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.wif.enabled}
                  onCheckedChange={(enabled) =>
                    setConfig({ ...config, wif: { ...config.wif, enabled } })
                  }
                />
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {[
                  ["MON", false],
                  ["TUE", true],
                  ["WED", false],
                  ["THU", false],
                  ["FRI", true],
                  ["SAT", false],
                  ["SUN", true],
                ].map(([day, active]) => (
                  <DayBadge
                    active={Boolean(active)}
                    day={String(day)}
                    key={String(day)}
                  />
                ))}
              </div>

              <div className="grid gap-x-5 md:grid-cols-2">
                <div>
                  <Rule>45m move ≤ {config.wif.move45mAtrMax} ATR</Rule>
                  <Rule>Volume z-score ≥ {config.wif.volumeZMin}</Rule>
                  <Rule>
                    Нижняя тень ≥{" "}
                    {(config.wif.lowerWickRatioMin * 100).toFixed(0)}% диапазона
                  </Rule>
                  <Rule>
                    Close location ≥{" "}
                    {(config.wif.closeLocationMin * 100).toFixed(0)}%
                  </Rule>
                </div>
                <div>
                  <Rule>Taker imbalance ≥ {config.wif.takerImbalanceMin}</Rule>
                  <Rule>OI z-score ≤ {config.wif.oiZMax}</Rule>
                  <Rule>Composite strength ≥ {config.wif.strengthMin}</Rule>
                  <Rule>Funding-crossing и overnight запрещены</Rule>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <ArrowDownRight className="size-3.5" /> Stop
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.wif.stopAtr} ATR
                  </div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Target className="size-3.5" /> Target
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.wif.targetR}R
                  </div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Activity className="size-3.5" /> Time exit
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.wif.maxHoldMinutes}m
                  </div>
                </div>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel
            subtitle="Funding already known · 15m delayed entry"
            title="DOTUSDT — Negative Funding Rebound"
          >
            <div className="space-y-5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-yellow-500/10">
                    <CircleDollarSign className="size-5 text-yellow-500" />
                  </div>
                  <div>
                    <p className="font-medium">
                      Возврат после экстремально отрицательного funding
                    </p>
                    <p className="text-muted-foreground text-xs">
                      Никакого использования будущего funding
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.dot.enabled}
                  onCheckedChange={(enabled) =>
                    setConfig({ ...config, dot: { ...config.dot, enabled } })
                  }
                />
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {[
                  ["MON", true],
                  ["TUE", true],
                  ["WED", false],
                  ["THU", false],
                  ["FRI", true],
                  ["SAT", true],
                  ["SUN", true],
                ].map(([day, active]) => (
                  <DayBadge
                    active={Boolean(active)}
                    day={String(day)}
                    key={String(day)}
                  />
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="text-[10px] text-muted-foreground uppercase">
                    Mon / Tue
                  </div>
                  <div className="mt-2 font-mono text-lg">≤ −2.25 bps</div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="text-[10px] text-muted-foreground uppercase">
                    Fri / Sat / Sun
                  </div>
                  <div className="mt-2 font-mono text-lg">≤ −2.50 bps</div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="text-[10px] text-muted-foreground uppercase">
                    Entry delay
                  </div>
                  <div className="mt-2 font-mono text-lg">
                    {config.dot.entryDelayMinutes}m
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <ArrowDownRight className="size-3.5" /> Stop
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.dot.stopAtr} ATR
                  </div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <ArrowUpRight className="size-3.5" /> Target
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.dot.targetR}R
                  </div>
                </div>
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Activity className="size-3.5" /> Time exit
                  </div>
                  <div className="mt-2 font-mono text-xl">
                    {config.dot.maxHoldMinutes / 60}h
                  </div>
                </div>
              </div>
            </div>
          </TerminalPanel>
        </div>

        <div className="space-y-4">
          <TerminalPanel
            subtitle="Закрытая equity управляет режимом"
            title="Risk Accelerator"
          >
            <div className="space-y-5 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  description="start"
                  label="WIF base risk"
                  max={15}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, baseWifRiskPercent: value },
                    })
                  }
                  value={config.risk.baseWifRiskPercent}
                />
                <NumberField
                  description="start"
                  label="DOT base risk"
                  max={15}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, baseDotRiskPercent: value },
                    })
                  }
                  value={config.risk.baseDotRiskPercent}
                />
                <NumberField
                  description="new HWM"
                  label="WIF boost risk"
                  max={20}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, boostWifRiskPercent: value },
                    })
                  }
                  value={config.risk.boostWifRiskPercent}
                />
                <NumberField
                  description="new HWM"
                  label="DOT boost risk"
                  max={20}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      risk: { ...config.risk, boostDotRiskPercent: value },
                    })
                  }
                  value={config.risk.boostDotRiskPercent}
                />
              </div>

              <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Zap className="size-4 text-primary" /> Boost gate
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <NumberField
                    label="Profit trigger"
                    max={100}
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
                    label="De-risk DD"
                    max={50}
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        risk: { ...config.risk, deRiskDrawdownPercent: value },
                      })
                    }
                    value={config.risk.deRiskDrawdownPercent}
                  />
                  <NumberField
                    label="Hard stop DD"
                    max={50}
                    onChange={(value) =>
                      setConfig({
                        ...config,
                        risk: {
                          ...config.risk,
                          hardStopDrawdownPercent: value,
                        },
                      })
                    }
                    value={config.risk.hardStopDrawdownPercent}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label="Maximum gross"
                  max={10}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      execution: {
                        ...config.execution,
                        maxGrossLeverage: value,
                      },
                    })
                  }
                  step={0.25}
                  suffix="x"
                  value={config.execution.maxGrossLeverage}
                />
                <NumberField
                  label="Cost reserve"
                  max={100}
                  onChange={(value) =>
                    setConfig({
                      ...config,
                      execution: {
                        ...config.execution,
                        roundTurnCostBps: value,
                      },
                    })
                  }
                  step={1}
                  suffix="bps"
                  value={config.execution.roundTurnCostBps}
                />
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel title="Execution contract">
            <div className="p-4">
              <Rule>Venue зафиксирован: Binance USD-M perpetual.</Rule>
              <Rule>
                Максимум {config.execution.maxPositions} позиции одновременно.
              </Rule>
              <Rule>
                Размер определяется stop-risk, а не фиксированным USDT.
              </Rule>
              <Rule>
                STOP_MARKET и TAKE_PROFIT_MARKET устанавливаются после входа.
              </Rule>
              <Rule>
                При ошибке защитных ордеров позиция закрывается аварийно.
              </Rule>
              <Rule>Strategy scheduler требует явного opt-in.</Rule>
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-yellow-500" />
              <div>
                <p className="font-medium text-sm">
                  Изменения риска не равны live-допуску
                </p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Forward gate, Binance testnet и контроль фактических costs
                  остаются обязательными. Исторические 100% не являются
                  гарантированным CAGR.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={!defaults.data}
              onClick={() => {
                if (!defaults.data) return;
                setConfig(defaults.data.config);
                toast.info("Исследовательские defaults восстановлены локально");
              }}
              variant="outline"
            >
              <RotateCcw className="mr-1 size-3.5" /> Restore researched
              defaults
            </Button>
            <Button className="flex-1" onClick={save}>
              <LockKeyhole className="mr-1 size-3.5" /> Save blueprint
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
