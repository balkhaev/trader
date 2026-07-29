"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Gauge,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  WalletCards,
  Waves,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { PageLoading, StatItem, StatRow } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useAutoTradingConfig,
  useAutoTradingLogs,
  useAutoTradingStats,
  useExecutionPreflight,
} from "@/hooks/use-auto-trading";
import { useExchangeOverview } from "@/hooks/use-exchange";
import { useClosedSignals, useSignals } from "@/hooks/use-signals";
import { useCanonicalStrategy, useStrategyStatus } from "@/hooks/use-strategy";

function strategyOnly<T extends { metadata: Record<string, unknown> | null }>(
  rows: T[] | undefined
) {
  return (rows ?? []).filter(
    (row) => row.metadata?.strategyKind === "consensus_wif_dot_v1"
  );
}

function Dot({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex size-2 rounded-full ${
        active ? "bg-primary" : "bg-muted-foreground/40"
      }`}
    />
  );
}

export default function StrategyTerminalPage() {
  const strategy = useCanonicalStrategy();
  const scheduler = useStrategyStatus();
  const execution = useAutoTradingConfig();
  const preflight = useExecutionPreflight();
  const stats = useAutoTradingStats();
  const logs = useAutoTradingLogs(10);
  const signals = useSignals({ limit: 200 });
  const closed = useClosedSignals({ limit: 200 });
  const overview = useExchangeOverview();

  if (strategy.isLoading || execution.isLoading || !strategy.data || !execution.data) {
    return (
      <div className="p-3 sm:p-4">
        <PageLoading count={10} variant="cards" />
      </div>
    );
  }

  const config = strategy.data.config;
  const runtime = config.runtime;
  const equity = runtime?.equity ?? preflight.data?.equity ?? 0;
  const initial = runtime?.initialEquity ?? equity;
  const highWater = runtime?.highWaterEquity ?? equity;
  const returnPercent = initial > 0 ? (equity / initial - 1) * 100 : 0;
  const drawdown = highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;
  const all = strategyOnly(signals.data);
  const closedTrades = strategyOnly(closed.data);
  const pending = all.filter((item) => item.status === "pending").length;
  const open = all.filter(
    (item) => item.status === "executed" && !item.exitPrice
  ).length;
  const wins = closedTrades.filter((item) => item.isWin).length;
  const account = overview.data?.accounts.at(0);
  const schedulerState = scheduler.data?.scheduler;

  return (
    <div className="p-3 sm:p-4">
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80">
        <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={strategy.data.isActive ? "default" : "secondary"}>
                {strategy.data.isActive ? "STRATEGY ACTIVE" : "STRATEGY PAUSED"}
              </Badge>
              <Badge variant={execution.data.enabled ? "default" : "outline"}>
                {execution.data.enabled ? "EXECUTION ARMED" : "EXECUTION OFF"}
              </Badge>
              <Badge variant={preflight.data?.ready ? "default" : "destructive"}>
                PREFLIGHT {preflight.data?.ready ? "READY" : "BLOCKED"}
              </Badge>
              <Badge variant="outline">
                {(runtime?.mode ?? "base").toUpperCase()}
              </Badge>
            </div>
            <h1 className="mt-5 max-w-4xl font-semibold text-3xl tracking-tight sm:text-5xl">
              Consensus WIF + DOT
              <span className="block text-primary">Risk Accelerator Terminal</span>
            </h1>
            <p className="mt-4 max-w-3xl text-muted-foreground text-sm leading-6 sm:text-base">
              Strategy-only runtime: WIF OI-flush, DOT negative-funding rebound,
              Binance USD-M preflight и закрытая equity как единственный источник
              risk mode.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/strategy-builder">
                <Button><Gauge className="mr-1 size-4" /> Blueprint</Button>
              </Link>
              <Link href="/signals">
                <Button variant="outline"><RadioTower className="mr-1 size-4" /> Signals</Button>
              </Link>
              <Link href="/auto-trading">
                <Button variant="outline"><Activity className="mr-1 size-4" /> Execution</Button>
              </Link>
              <Link href="/validation">
                <Button variant="ghost">Forward gate <ArrowRight className="ml-1 size-4" /></Button>
              </Link>
            </div>
          </div>

          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l sm:p-7">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Closed equity
            </div>
            <div className="mt-2 font-mono text-4xl">
              {equity
                ? `${equity.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} USDT`
                : "—"}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase">Return</div>
                <div className={`mt-1 font-mono text-xl ${returnPercent >= 0 ? "text-primary" : "text-destructive"}`}>
                  {returnPercent >= 0 ? "+" : ""}{returnPercent.toFixed(2)}%
                </div>
              </div>
              <div className="rounded-xl border bg-card/60 p-3">
                <div className="text-[9px] text-muted-foreground uppercase">Drawdown</div>
                <div className="mt-1 font-mono text-xl">{drawdown.toFixed(2)}%</div>
              </div>
            </div>
            <div className="mt-4 space-y-2 font-mono text-[10px] text-muted-foreground">
              <State label="Strategy" active={strategy.data.isActive} value={strategy.data.isActive ? "active" : "paused"} />
              <State label="Execution" active={execution.data.enabled} value={execution.data.enabled ? "armed" : "off"} />
              <State label="Scheduler" active={Boolean(schedulerState?.enabled)} value={schedulerState?.enabled ? schedulerState.nextRunAt ? new Date(schedulerState.nextRunAt).toLocaleTimeString("ru-RU") : "running" : "opt-in disabled"} />
            </div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-6">
        <StatItem label="Risk mode" value={(runtime?.mode ?? "base").toUpperCase()} />
        <StatItem label="Pending" value={pending} />
        <StatItem label="Open" value={open} />
        <StatItem label="Closed" value={closedTrades.length} />
        <StatItem label="Win rate" value={closedTrades.length ? `${((wins / closedTrades.length) * 100).toFixed(1)}%` : "—"} />
        <StatItem label="Errors today" value={stats.data?.todayErrors ?? 0} />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <Module
            icon={Waves}
            subtitle="Tue / Fri / Sun · 15m"
            title="WIF OI Flush Reclaim"
            values={[
              [`${config.wif.stopAtr} ATR`, "stop"],
              [`${config.wif.targetR}R`, "target"],
              [`${config.wif.maxHoldMinutes}m`, "exit"],
            ]}
            risk={`${config.risk.baseWifRiskPercent}% / ${config.risk.boostWifRiskPercent}%`}
          />
          <Module
            icon={CircleDollarSign}
            subtitle="Published negative funding"
            title="DOT Funding Rebound"
            values={[
              [`${config.dot.stopAtr} ATR`, "stop"],
              [`${config.dot.targetR}R`, "target"],
              [`${config.dot.maxHoldMinutes / 60}h`, "exit"],
            ]}
            risk={`${config.risk.baseDotRiskPercent}% / ${config.risk.boostDotRiskPercent}%`}
          />
          <TerminalPanel title="Risk Accelerator">
            <div className="grid grid-cols-3 gap-2 p-4 text-center">
              <Risk icon={Zap} label="boost" value={`+${config.risk.boostTriggerProfitPercent}%`} />
              <Risk icon={ShieldCheck} label="de-risk" value={`−${config.risk.deRiskDrawdownPercent}%`} />
              <Risk icon={ShieldAlert} label="stop" value={`−${config.risk.hardStopDrawdownPercent}%`} />
            </div>
          </TerminalPanel>
          <TerminalPanel title="Binance USD-M">
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <WalletCards className="size-5 text-primary" />
                <div>
                  <p className="text-sm">{account?.accountName ?? "Not connected"}</p>
                  <p className="text-muted-foreground text-xs">
                    {account ? `${account.testnet ? "TESTNET" : "LIVE"} · ${account.positionsCount} positions` : "Connect Binance testnet"}
                  </p>
                </div>
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                Gross cap {config.execution.maxGrossLeverage}x · cost reserve {config.execution.roundTurnCostBps} bps
              </div>
            </div>
          </TerminalPanel>
        </div>

        <TerminalPanel subtitle="latest decisions" title="Execution Feed">
          <div className="max-h-[560px] overflow-y-auto">
            {logs.data?.logs.length ? (
              logs.data.logs.map((log) => (
                <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-border/60 border-b p-3 last:border-0" key={log.id}>
                  {log.action === "error" ? (
                    <TriangleAlert className="mt-1 size-4 text-destructive" />
                  ) : log.action === "skipped" ? (
                    <Clock3 className="mt-1 size-4 text-yellow-500" />
                  ) : (
                    <CheckCircle2 className="mt-1 size-4 text-primary" />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant={log.action === "error" ? "destructive" : "secondary"}>{log.action}</Badge>
                      {log.details?.symbol ? <span className="font-mono text-xs">{String(log.details.symbol)}</span> : null}
                    </div>
                    <p className="mt-1 text-muted-foreground text-xs">{log.reason}</p>
                  </div>
                  <span className="font-mono text-[10px] text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString("ru-RU")}</span>
                </div>
              ))
            ) : (
              <div className="py-16 text-center text-muted-foreground text-sm">
                Execution feed пуст.
              </div>
            )}
          </div>
        </TerminalPanel>
      </div>
    </div>
  );
}

function State({ label, active, value }: { label: string; active: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="flex items-center gap-2"><Dot active={active} />{value}</span>
    </div>
  );
}

function Module({ icon: Icon, title, subtitle, values, risk }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle: string; values: Array<[string, string]>; risk: string }) {
  return (
    <TerminalPanel subtitle={subtitle} title={title}>
      <div className="space-y-4 p-4">
        <Icon className="size-5 text-primary" />
        <div className="grid grid-cols-3 gap-2 text-center">
          {values.map(([value, label]) => (
            <div className="rounded-lg border bg-background/40 p-2" key={label}>
              <div className="font-mono">{value}</div>
              <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex justify-between border-border/60 border-t pt-3 text-xs">
          <span className="text-muted-foreground">Base / boost risk</span>
          <span className="font-mono">{risk}</span>
        </div>
      </div>
    </TerminalPanel>
  );
}

function Risk({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-background/40 p-3">
      <Icon className="mx-auto size-4 text-primary" />
      <div className="mt-2 font-mono text-lg">{value}</div>
      <div className="text-[9px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
