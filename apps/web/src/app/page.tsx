"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Crosshair,
  Gauge,
  Play,
  RadioTower,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
  Waves,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  PageLayout,
  PageLoading,
  StatItem,
  StatRow,
} from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useAutoTradingConfig,
  useAutoTradingLogs,
  useAutoTradingStats,
} from "@/hooks/use-auto-trading";
import { useExchangeOverview } from "@/hooks/use-exchange";
import { type Signal, useSignals } from "@/hooks/use-signals";
import { useCanonicalStrategy, useScanStrategy } from "@/hooks/use-strategy";

interface StrategySignalMetadata {
  strategyKind?: string;
  reasoning?: string;
  strategySignal?: {
    module?: "wif_oi_flush" | "dot_funding_rebound";
    stopPrice?: number;
    takeProfitPrice?: number;
  };
  positionPreview?: {
    riskPercent?: number;
    grossLeverageAfter?: number;
  };
}

function signalMetadata(signal: Signal) {
  return (signal.metadata ?? {}) as StrategySignalMetadata;
}

const money = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUsdt(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? `${money.format(parsed)} USDT` : "—";
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function moduleLabel(signal: Signal) {
  const module = signalMetadata(signal).strategySignal?.module;
  if (module === "wif_oi_flush") return "WIF OI FLUSH";
  if (module === "dot_funding_rebound") return "DOT FUNDING";
  return signal.symbol;
}

function StatusLine({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-border/60 border-b py-2 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        {ok ? (
          <CheckCircle2 className="size-4 text-primary" />
        ) : (
          <TriangleAlert className="size-4 text-yellow-500" />
        )}
        <span>{label}</span>
      </div>
      <span className="font-mono text-muted-foreground text-xs">{value}</span>
    </div>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const meta = signalMetadata(signal);
  const preview = meta.positionPreview;
  const strategySignal = meta.strategySignal;
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-border/60 border-b px-3 py-3 last:border-0 hover:bg-muted/25">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{moduleLabel(signal)}</Badge>
          <span className="font-mono text-xs">{signal.symbol}</span>
          <Badge
            variant={
              signal.status === "executed"
                ? "default"
                : signal.status === "rejected"
                  ? "destructive"
                  : "secondary"
            }
          >
            {signal.status}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-1 text-muted-foreground text-xs">
          {meta.reasoning ?? "Deterministic strategy candidate"}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
          {strategySignal?.stopPrice ? (
            <span>STOP {Number(strategySignal.stopPrice).toPrecision(6)}</span>
          ) : null}
          {strategySignal?.takeProfitPrice ? (
            <span>
              TP {Number(strategySignal.takeProfitPrice).toPrecision(6)}
            </span>
          ) : null}
          {preview?.riskPercent ? (
            <span>RISK {preview.riskPercent.toFixed(2)}%</span>
          ) : null}
          {preview?.grossLeverageAfter ? (
            <span>GROSS {preview.grossLeverageAfter.toFixed(2)}x</span>
          ) : null}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm">
          {Number(signal.strength || 0).toFixed(1)}
        </div>
        <div className="text-[10px] text-muted-foreground">strength</div>
        <div className="mt-2 font-mono text-[10px] text-muted-foreground">
          {new Date(signal.createdAt).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

export default function StrategyTerminalPage() {
  const canonical = useCanonicalStrategy();
  const scan = useScanStrategy();
  const { data: execution } = useAutoTradingConfig();
  const { data: executionStats } = useAutoTradingStats();
  const { data: executionLogs } = useAutoTradingLogs(8);
  const { data: overview } = useExchangeOverview();
  const { data: allSignals } = useSignals({ limit: 100 });

  if (canonical.isLoading || !canonical.data) {
    return (
      <PageLayout title="Strategy Terminal">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const strategy = canonical.data;
  const runtime = strategy.config.runtime;
  const initialEquity = runtime?.initialEquity ?? 0;
  const equity = runtime?.equity ?? initialEquity;
  const highWater = runtime?.highWaterEquity ?? equity;
  const returnPercent =
    initialEquity > 0 ? (equity / initialEquity - 1) * 100 : 0;
  const drawdownPercent =
    highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;
  const boostProgress = Math.max(
    0,
    Math.min(
      100,
      (returnPercent / strategy.config.risk.boostTriggerProfitPercent) * 100
    )
  );
  const hardStopProgress = Math.max(
    0,
    Math.min(
      100,
      (drawdownPercent / strategy.config.risk.hardStopDrawdownPercent) * 100
    )
  );
  const strategySignals = (allSignals ?? []).filter(
    (signal) =>
      signalMetadata(signal).strategyKind === "consensus_wif_dot_v1" ||
      signal.symbol === "WIFUSDT" ||
      signal.symbol === "DOTUSDT"
  );
  const binanceAccount = overview?.accounts.find(
    (account) => account.exchange === "binance"
  );
  const mode = runtime?.mode ?? "base";

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
          ? `Найдено ${result.signals.length}, исполнено ${executed}`
          : "Новых WIF/DOT сигналов нет"
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
            disabled={
              scan.isPending || !strategy.isActive || !execution?.enabled
            }
            onClick={() => runScan(true)}
            size="sm"
          >
            <Play className="mr-1 size-3.5" /> Scan & execute
          </Button>
        </div>
      }
      subtitle="Единый операционный экран Consensus WIF + DOT Risk Accelerator"
      title="Strategy Terminal"
    >
      <section className="strategy-grid strategy-glow overflow-hidden rounded-2xl border border-primary/20 bg-card/80">
        <div className="grid gap-0 lg:grid-cols-[1.4fr_1fr]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={strategy.isActive ? "default" : "secondary"}>
                {strategy.isActive ? "STRATEGY ACTIVE" : "STRATEGY PAUSED"}
              </Badge>
              <Badge variant={mode === "stopped" ? "destructive" : "outline"}>
                MODE {mode.toUpperCase()}
              </Badge>
              <Badge variant="outline">BINANCE USD-M</Badge>
              <Badge variant="outline">15M LONG-ONLY</Badge>
            </div>
            <h2 className="mt-5 max-w-3xl font-semibold text-2xl tracking-tight sm:text-4xl">
              Два независимых сигнала. Один контролируемый риск-контур.
            </h2>
            <p className="mt-3 max-w-3xl text-muted-foreground text-sm leading-6">
              WIF ловит OI-flush с возвратом цены. DOT торгует отскок после уже
              опубликованного глубоко отрицательного funding. Размер позиции,
              защитные ордера, boost, de-risk и hard stop определяет стратегия.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/strategy-builder">
                <Button size="sm" variant="outline">
                  Открыть стратегию <ArrowRight className="ml-1 size-3.5" />
                </Button>
              </Link>
              <Link href="/auto-trading">
                <Button size="sm" variant="outline">
                  Исполнение <ArrowRight className="ml-1 size-3.5" />
                </Button>
              </Link>
              <Link href="/validation">
                <Button size="sm" variant="ghost">
                  Forward gate <ShieldCheck className="ml-1 size-3.5" />
                </Button>
              </Link>
            </div>
          </div>

          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l sm:p-7">
            <div className="text-[10px] text-muted-foreground uppercase tracking-[0.2em]">
              Closed equity state
            </div>
            <div className="mt-2 font-mono font-semibold text-3xl">
              {formatUsdt(equity)}
            </div>
            <div
              className={`mt-1 font-mono text-sm ${
                returnPercent >= 0 ? "text-primary" : "text-destructive"
              }`}
            >
              {formatPercent(returnPercent)} от initial equity
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted-foreground">Путь к boost</span>
                  <span className="font-mono">
                    {returnPercent.toFixed(2)} /{" "}
                    {strategy.config.risk.boostTriggerProfitPercent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${boostProgress}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    Просадка к hard stop
                  </span>
                  <span className="font-mono">
                    {drawdownPercent.toFixed(2)} /{" "}
                    {strategy.config.risk.hardStopDrawdownPercent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive transition-all"
                    style={{ width: `${hardStopProgress}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="Risk mode" value={mode.toUpperCase()} />
        <StatItem label="Closed return" value={formatPercent(returnPercent)} />
        <StatItem label="Drawdown" value={`${drawdownPercent.toFixed(2)}%`} />
        <StatItem label="Strategy signals" value={strategySignals.length} />
        <StatItem
          label="Executed today"
          value={executionStats?.todayExecuted ?? 0}
        />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <TerminalPanel
              subtitle="Tuesday / Friday / Sunday"
              title="WIF OI Flush"
            >
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <Waves className="size-5 text-primary" />
                  </div>
                  <Badge
                    variant={
                      strategy.config.wif.enabled ? "default" : "secondary"
                    }
                  >
                    {strategy.config.wif.enabled ? "ENABLED" : "OFF"}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-5">
                  Падение за 45 минут не менее 2 ATR, всплеск объёма, нижняя
                  тень, возврат закрытия, OI z ≤ −1 и strength ≥ 3,5.
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.wif.stopAtr} ATR
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      stop
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.wif.targetR}R
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      target
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.wif.maxHoldMinutes}m
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      hold
                    </div>
                  </div>
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel
              subtitle="Known funding only"
              title="DOT Funding Rebound"
            >
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-yellow-500/10">
                    <CircleDollarSign className="size-5 text-yellow-500" />
                  </div>
                  <Badge
                    variant={
                      strategy.config.dot.enabled ? "default" : "secondary"
                    }
                  >
                    {strategy.config.dot.enabled ? "ENABLED" : "OFF"}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs leading-5">
                  Long через 15 минут после funding: Mon/Tue ≤ −2,25 bps,
                  Fri/Sat/Sun ≤ −2,50 bps. Среда и четверг пропускаются.
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.dot.stopAtr} ATR
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      stop
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.dot.targetR}R
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      target
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background/40 p-2">
                    <div className="font-mono text-sm">
                      {strategy.config.dot.maxHoldMinutes / 60}h
                    </div>
                    <div className="text-[9px] text-muted-foreground uppercase">
                      hold
                    </div>
                  </div>
                </div>
              </div>
            </TerminalPanel>
          </div>

          <TerminalPanel
            action={
              <Link href="/signals">
                <Button size="sm" variant="ghost">
                  Все сигналы <ArrowRight className="ml-1 size-3" />
                </Button>
              </Link>
            }
            subtitle={`${strategySignals.length} strategy events`}
            title="Последние сигналы"
          >
            {strategySignals.length ? (
              strategySignals
                .slice(0, 6)
                .map((signal) => <SignalRow key={signal.id} signal={signal} />)
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Crosshair className="size-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm">Сигналов пока нет</p>
                <p className="mt-1 max-w-md text-muted-foreground text-xs">
                  Запустите shadow scan. Сигнал появится только при выполнении
                  полного набора WIF или DOT условий.
                </p>
              </div>
            )}
          </TerminalPanel>
        </div>

        <div className="space-y-4">
          <TerminalPanel title="Operational readiness">
            <div className="p-4">
              <StatusLine
                label="Стратегия"
                ok={strategy.isActive}
                value={strategy.isActive ? "active" : "paused"}
              />
              <StatusLine
                label="Исполнение"
                ok={Boolean(execution?.enabled)}
                value={execution?.enabled ? "enabled" : "disabled"}
              />
              <StatusLine
                label="Binance account"
                ok={Boolean(binanceAccount)}
                value={
                  binanceAccount?.testnet
                    ? "testnet"
                    : binanceAccount
                      ? "live"
                      : "not connected"
                }
              />
              <StatusLine
                label="Risk state"
                ok={mode !== "stopped"}
                value={mode}
              />
              <StatusLine
                label="Position limit"
                ok={strategy.config.execution.maxPositions <= 2}
                value={`${strategy.config.execution.maxPositions} max`}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel
            subtitle="Risk lives inside strategy"
            title="Accelerator"
          >
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-background/40 p-3">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Gauge className="size-3.5" /> Base
                  </div>
                  <div className="mt-2 font-mono text-lg">
                    {strategy.config.risk.baseWifRiskPercent}% /{" "}
                    {strategy.config.risk.baseDotRiskPercent}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    WIF / DOT stop-risk
                  </div>
                </div>
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                  <div className="flex items-center gap-2 text-primary text-xs">
                    <Zap className="size-3.5" /> Boost
                  </div>
                  <div className="mt-2 font-mono text-lg">
                    {strategy.config.risk.boostWifRiskPercent}% /{" "}
                    {strategy.config.risk.boostDotRiskPercent}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    after new HWM +15%
                  </div>
                </div>
              </div>
              <div className="rounded-xl border bg-background/40 p-3 text-xs leading-5">
                <div className="flex items-center gap-2 font-medium">
                  <ShieldCheck className="size-4 text-primary" /> Automatic
                  protection
                </div>
                <p className="mt-1 text-muted-foreground">
                  De-risk при {strategy.config.risk.deRiskDrawdownPercent}% от
                  HWM, sticky hard stop при{" "}
                  {strategy.config.risk.hardStopDrawdownPercent}%, gross cap{" "}
                  {strategy.config.execution.maxGrossLeverage}x.
                </p>
              </div>
            </div>
          </TerminalPanel>

          <TerminalPanel
            subtitle="Последние действия движка"
            title="Execution feed"
          >
            <div className="max-h-[320px] overflow-y-auto">
              {executionLogs?.logs.length ? (
                executionLogs.logs.map((log) => (
                  <div
                    className="flex items-start gap-3 border-border/60 border-b px-3 py-3 last:border-0"
                    key={log.id}
                  >
                    <div className="mt-0.5 flex size-7 items-center justify-center rounded-lg bg-muted">
                      {log.action === "executed" ? (
                        <Activity className="size-3.5 text-primary" />
                      ) : log.action === "error" ? (
                        <TriangleAlert className="size-3.5 text-destructive" />
                      ) : (
                        <Clock3 className="size-3.5 text-yellow-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs uppercase">
                          {log.action}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(log.createdAt).toLocaleTimeString("ru-RU")}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
                        {log.reason}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-5 text-center text-muted-foreground text-xs">
                  Execution feed пуст.
                </div>
              )}
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3">
              <WalletCards className="mt-0.5 size-5 text-yellow-500" />
              <div>
                <p className="font-medium text-sm">
                  Live scheduler выключен по умолчанию
                </p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Для автоматического цикла требуется явный opt-in через
                  STRATEGY_SCHEDULER_ENABLED=true. До forward gate используйте
                  Binance testnet и shadow scan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
