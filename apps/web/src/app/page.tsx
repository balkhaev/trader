"use client";

import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Crosshair,
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
import { useAutoTradingConfig, useAutoTradingLogs, useAutoTradingStats } from "@/hooks/use-auto-trading";
import { useExchangeOverview } from "@/hooks/use-exchange";
import { useClosedSignals, useSignals } from "@/hooks/use-signals";
import { useCanonicalStrategy } from "@/hooks/use-strategy";

interface StrategyMeta {
  strategyKind?: string;
  strategySignal?: { module?: string; stopPrice?: number; takeProfitPrice?: number };
}

function isStrategySignal(signal: { symbol: string; metadata: Record<string, unknown> | null }) {
  const meta = (signal.metadata ?? {}) as StrategyMeta;
  return meta.strategyKind === "consensus_wif_dot_v1" || signal.symbol === "WIFUSDT" || signal.symbol === "DOTUSDT";
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex size-2 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/40"}`} />
  );
}

export default function StrategyTerminalPage() {
  const canonical = useCanonicalStrategy();
  const auto = useAutoTradingConfig();
  const stats = useAutoTradingStats();
  const logs = useAutoTradingLogs(8);
  const signals = useSignals({ limit: 100 });
  const closed = useClosedSignals({ limit: 100 });
  const overview = useExchangeOverview();

  if (canonical.isLoading || auto.isLoading || !canonical.data || !auto.data) {
    return (
      <div className="p-3 sm:p-4">
        <PageLoading count={10} variant="cards" />
      </div>
    );
  }

  const strategy = canonical.data;
  const config = strategy.config;
  const runtime = config.runtime;
  const equity = runtime?.equity ?? 0;
  const initial = runtime?.initialEquity ?? equity;
  const highWater = runtime?.highWaterEquity ?? equity;
  const strategyReturn = initial > 0 ? (equity / initial - 1) * 100 : 0;
  const drawdown = highWater > 0 ? Math.max(0, (1 - equity / highWater) * 100) : 0;
  const strategySignals = (signals.data ?? []).filter(isStrategySignal);
  const pending = strategySignals.filter((signal) => signal.status === "pending");
  const executed = strategySignals.filter((signal) => signal.status === "executed");
  const closedTrades = (closed.data ?? []).filter(isStrategySignal);
  const wins = closedTrades.filter((signal) => signal.isWin === true).length;
  const totalReturn = closedTrades.reduce((sum, signal) => sum + Number(signal.realizedPnl ?? 0), 0);
  const mode = (runtime?.mode ?? "base").toUpperCase();
  const account = overview.data?.accounts.find((item) => item.exchange === "binance");
  const schedulerOptIn = false;

  return (
    <div className="p-3 sm:p-4">
      <section className="strategy-grid overflow-hidden rounded-2xl border bg-card/80">
        <div className="grid lg:grid-cols-[1.35fr_0.65fr]">
          <div className="p-5 sm:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={strategy.isActive ? "default" : "secondary"}>{strategy.isActive ? "STRATEGY ACTIVE" : "STRATEGY PAUSED"}</Badge>
              <Badge variant={auto.data.enabled ? "default" : "outline"}>{auto.data.enabled ? "EXECUTION ARMED" : "EXECUTION OFF"}</Badge>
              <Badge variant="outline">{mode}</Badge>
              <Badge variant="outline">BINANCE USD-M</Badge>
            </div>
            <h1 className="mt-5 max-w-4xl font-semibold text-3xl tracking-tight sm:text-5xl">
              Consensus WIF + DOT
              <span className="block text-primary">Risk Accelerator Terminal</span>
            </h1>
            <p className="mt-4 max-w-3xl text-muted-foreground text-sm leading-6 sm:text-base">
              Одна детерминированная стратегия, два подтверждённых модуля, явный risk state и никакого универсального AI-trading UX. Терминал показывает только то, что влияет на WIF/DOT scan, execution и forward gate.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Link href="/strategy-builder"><Button><Gauge className="mr-1 size-4" /> Blueprint</Button></Link>
              <Link href="/signals"><Button variant="outline"><RadioTower className="mr-1 size-4" /> Signals</Button></Link>
              <Link href="/auto-trading"><Button variant="outline"><Activity className="mr-1 size-4" /> Execution</Button></Link>
              <Link href="/validation"><Button variant="ghost">Forward gate <ArrowRight className="ml-1 size-4" /></Button></Link>
            </div>
          </div>
          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l sm:p-7">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Runtime equity</div>
            <div className="mt-2 font-mono text-4xl">{equity ? equity.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—"}</div>
            <div className="mt-1 text-muted-foreground text-xs">USDT closed equity</div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-card/60 p-3"><div className="text-[9px] text-muted-foreground uppercase">Return</div><div className={`mt-1 font-mono text-xl ${strategyReturn >= 0 ? "text-primary" : "text-destructive"}`}>{strategyReturn >= 0 ? "+" : ""}{strategyReturn.toFixed(2)}%</div></div>
              <div className="rounded-xl border bg-card/60 p-3"><div className="text-[9px] text-muted-foreground uppercase">Drawdown</div><div className="mt-1 font-mono text-xl">{drawdown.toFixed(2)}%</div></div>
            </div>
            <div className="mt-4 space-y-2 font-mono text-[10px] text-muted-foreground">
              <div className="flex items-center justify-between"><span>Strategy</span><span className="flex items-center gap-2"><StatusDot active={strategy.isActive} />{strategy.isActive ? "active" : "paused"}</span></div>
              <div className="flex items-center justify-between"><span>Execution</span><span className="flex items-center gap-2"><StatusDot active={auto.data.enabled} />{auto.data.enabled ? "armed" : "off"}</span></div>
              <div className="flex items-center justify-between"><span>Scheduler</span><span className="flex items-center gap-2"><StatusDot active={schedulerOptIn} />opt-in env</span></div>
            </div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-6">
        <StatItem label="Risk mode" value={mode} />
        <StatItem label="Pending signals" value={pending.length} />
        <StatItem label="Open/executed" value={executed.length} />
        <StatItem label="Closed trades" value={closedTrades.length} />
        <StatItem label="Win rate" value={closedTrades.length ? `${((wins / closedTrades.length) * 100).toFixed(1)}%` : "—"} />
        <StatItem label="Closed return" value={closedTrades.length ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%` : "—"} />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-4 md:grid-cols-2">
          <TerminalPanel subtitle="Tue / Fri / Sun · 15m" title="WIF OI Flush Reclaim">
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary/10"><Waves className="size-5 text-primary" /></div><div><p className="font-medium text-sm">Liquidation rebound</p><p className="text-muted-foreground text-xs">OI contracts while price reclaims the candle</p></div></div>
              <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.wif.stopAtr} ATR</div><div className="text-[9px] text-muted-foreground uppercase">stop</div></div><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.wif.targetR}R</div><div className="text-[9px] text-muted-foreground uppercase">target</div></div><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.wif.maxHoldMinutes}m</div><div className="text-[9px] text-muted-foreground uppercase">exit</div></div></div>
              <div className="flex items-center justify-between border-border/60 border-t pt-3 text-xs"><span className="text-muted-foreground">Base / boost risk</span><span className="font-mono">{config.risk.baseWifRiskPercent}% / {config.risk.boostWifRiskPercent}%</span></div>
            </div>
          </TerminalPanel>

          <TerminalPanel subtitle="Known negative funding · long" title="DOT Funding Rebound">
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-yellow-500/10"><CircleDollarSign className="size-5 text-yellow-500" /></div><div><p className="font-medium text-sm">Post-funding drift</p><p className="text-muted-foreground text-xs">Entry 15 minutes after published funding</p></div></div>
              <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.dot.stopAtr} ATR</div><div className="text-[9px] text-muted-foreground uppercase">stop</div></div><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.dot.targetR}R</div><div className="text-[9px] text-muted-foreground uppercase">target</div></div><div className="rounded-lg border bg-background/40 p-2"><div className="font-mono">{config.dot.maxHoldMinutes / 60}h</div><div className="text-[9px] text-muted-foreground uppercase">exit</div></div></div>
              <div className="flex items-center justify-between border-border/60 border-t pt-3 text-xs"><span className="text-muted-foreground">Base / boost risk</span><span className="font-mono">{config.risk.baseDotRiskPercent}% / {config.risk.boostDotRiskPercent}%</span></div>
            </div>
          </TerminalPanel>

          <TerminalPanel subtitle="Equity-driven allocation" title="Risk Accelerator">
            <div className="grid grid-cols-3 gap-2 p-4 text-center"><div className="rounded-xl border bg-background/40 p-3"><Zap className="mx-auto size-4 text-primary" /><div className="mt-2 font-mono text-lg">+{config.risk.boostTriggerProfitPercent}%</div><div className="text-[9px] text-muted-foreground uppercase">boost trigger</div></div><div className="rounded-xl border bg-background/40 p-3"><ShieldCheck className="mx-auto size-4 text-primary" /><div className="mt-2 font-mono text-lg">−{config.risk.deRiskDrawdownPercent}%</div><div className="text-[9px] text-muted-foreground uppercase">de-risk</div></div><div className="rounded-xl border bg-background/40 p-3"><ShieldAlert className="mx-auto size-4 text-destructive" /><div className="mt-2 font-mono text-lg">−{config.risk.hardStopDrawdownPercent}%</div><div className="text-[9px] text-muted-foreground uppercase">hard stop</div></div></div>
          </TerminalPanel>

          <TerminalPanel subtitle="Operational venue" title="Binance USD-M">
            <div className="space-y-3 p-4"><div className="flex items-center gap-3"><WalletCards className="size-5 text-primary" /><div><p className="text-sm">{account?.accountName ?? "Account not connected"}</p><p className="text-muted-foreground text-xs">{account ? `${account.testnet ? "TESTNET" : "LIVE"} · ${account.positionsCount} positions` : "Connect Binance before execution"}</p></div></div><div className="grid grid-cols-2 gap-2"><div className="rounded-lg border bg-background/40 p-3"><div className="text-[9px] text-muted-foreground uppercase">Available</div><div className="mt-1 font-mono">{account ? Number(account.availableBalance).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) : "—"}</div></div><div className="rounded-lg border bg-background/40 p-3"><div className="text-[9px] text-muted-foreground uppercase">Gross cap</div><div className="mt-1 font-mono">{config.execution.maxGrossLeverage}x</div></div></div></div>
          </TerminalPanel>
        </div>

        <div className="space-y-4">
          <TerminalPanel subtitle="Latest execution decisions" title="Execution Feed">
            <div className="max-h-[430px] overflow-y-auto">
              {logs.data?.logs.length ? logs.data.logs.map((log) => (
                <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-border/60 border-b px-3 py-3 last:border-0" key={log.id}>
                  <div className="flex size-8 items-center justify-center rounded-lg bg-muted">{log.action === "executed" ? <CheckCircle2 className="size-4 text-primary" /> : log.action === "error" ? <TriangleAlert className="size-4 text-destructive" /> : <Clock3 className="size-4 text-yellow-500" />}</div>
                  <div className="min-w-0"><div className="flex items-center gap-2"><Badge variant={log.action === "error" ? "destructive" : "secondary"}>{log.action}</Badge>{log.details?.symbol ? <span className="font-mono text-xs">{String(log.details.symbol)}</span> : null}</div><p className="mt-1 line-clamp-2 text-muted-foreground text-xs">{log.reason}</p></div>
                  <span className="font-mono text-[9px] text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString("ru-RU")}</span>
                </div>
              )) : <div className="py-16 text-center"><Activity className="mx-auto size-9 text-muted-foreground/40" /><p className="mt-3 text-sm">Execution feed пуст</p><p className="mt-1 text-muted-foreground text-xs">Селективная стратегия может долго не давать сигналов.</p></div>}
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 size-5 text-yellow-500" /><div><p className="font-medium text-sm">100% CAGR — upside, не обещание</p><p className="mt-1 text-muted-foreground text-xs leading-5">Forward gate требует 30 новых сделок, PF ≥ 1.35, положительный результат без трёх лучших и costs ≤ 24 bps. До этого boost остаётся исследовательским режимом.</p></div></div>
          </div>
        </div>
      </div>
    </div>
  );
}
