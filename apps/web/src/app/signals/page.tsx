"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  RadioTower,
  ShieldCheck,
  Target,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageLayout, PageLoading, StatItem, StatRow } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import { type Signal, useClosedSignals, useSignals } from "@/hooks/use-signals";

interface StrategySignalPayload {
  module?: "wif_oi_flush" | "dot_funding_rebound";
  signalTime?: string;
  reason?: string;
  entryPrice?: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  maxHoldMinutes?: number;
}

interface PositionPreview {
  quantity?: number;
  notional?: number;
  riskPercent?: number;
  grossLeverageAfter?: number;
}

interface StrategyMetadata {
  strategyKind?: string;
  reasoning?: string;
  strategySignal?: StrategySignalPayload;
  positionPreview?: PositionPreview;
  autoTraded?: boolean;
  scannedAt?: string;
}

function metadata(signal: Signal) {
  return (signal.metadata ?? {}) as StrategyMetadata;
}

function isStrategySignal(signal: Signal) {
  const meta = metadata(signal);
  return (
    meta.strategyKind === "consensus_wif_dot_v1" ||
    signal.symbol === "WIFUSDT" ||
    signal.symbol === "DOTUSDT"
  );
}

function moduleTitle(signal: Signal) {
  const module = metadata(signal).strategySignal?.module;
  if (module === "wif_oi_flush") return "WIF OI FLUSH";
  if (module === "dot_funding_rebound") return "DOT FUNDING REBOUND";
  return signal.symbol;
}

function statusIcon(status: Signal["status"]) {
  if (status === "executed") return CheckCircle2;
  if (status === "rejected") return XCircle;
  if (status === "expired") return Clock3;
  return RadioTower;
}

function SignalCard({ signal }: { signal: Signal }) {
  const meta = metadata(signal);
  const payload = meta.strategySignal;
  const preview = meta.positionPreview;
  const StatusIcon = statusIcon(signal.status);

  return (
    <div className="rounded-xl border bg-card/70 p-4 transition-colors hover:border-primary/30 hover:bg-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{moduleTitle(signal)}</Badge>
            <Badge
              variant={
                signal.status === "executed"
                  ? "default"
                  : signal.status === "rejected"
                    ? "destructive"
                    : "secondary"
              }
            >
              <StatusIcon className="mr-1 size-3" /> {signal.status}
            </Badge>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono font-semibold text-xl">{signal.symbol}</span>
            <span className="font-mono text-muted-foreground text-xs">LONG</span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl">{Number(signal.strength || 0).toFixed(1)}</div>
          <div className="text-[10px] text-muted-foreground uppercase">strength</div>
        </div>
      </div>

      <p className="mt-3 min-h-10 text-muted-foreground text-xs leading-5">
        {meta.reasoning ?? payload?.reason ?? "Deterministic strategy candidate"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-background/40 p-2.5">
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
            <Crosshair className="size-3" /> Entry
          </div>
          <div className="mt-1 font-mono text-xs">
            {payload?.entryPrice ? Number(payload.entryPrice).toPrecision(6) : "next bar"}
          </div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2.5">
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
            <ArrowDownRight className="size-3" /> Stop
          </div>
          <div className="mt-1 font-mono text-xs">
            {payload?.stopPrice ? Number(payload.stopPrice).toPrecision(6) : "—"}
          </div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2.5">
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
            <Target className="size-3" /> Target
          </div>
          <div className="mt-1 font-mono text-xs">
            {payload?.takeProfitPrice
              ? Number(payload.takeProfitPrice).toPrecision(6)
              : "—"}
          </div>
        </div>
        <div className="rounded-lg border bg-background/40 p-2.5">
          <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
            <ShieldCheck className="size-3" /> Risk
          </div>
          <div className="mt-1 font-mono text-xs">
            {preview?.riskPercent !== undefined
              ? `${preview.riskPercent.toFixed(2)}%`
              : "—"}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-border/60 border-t pt-3 text-[10px] text-muted-foreground">
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
          {preview?.notional !== undefined ? (
            <span>NOTIONAL {preview.notional.toFixed(2)} USDT</span>
          ) : null}
          {preview?.grossLeverageAfter !== undefined ? (
            <span>GROSS {preview.grossLeverageAfter.toFixed(2)}x</span>
          ) : null}
          {payload?.maxHoldMinutes ? <span>MAX HOLD {payload.maxHoldMinutes}m</span> : null}
        </div>
        <span className="font-mono">
          {new Date(signal.createdAt).toLocaleString("ru-RU")}
        </span>
      </div>
    </div>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Activity className="size-10 text-muted-foreground/40" />
      <p className="mt-4 font-medium">{title}</p>
      <p className="mt-1 max-w-md text-muted-foreground text-xs leading-5">{text}</p>
    </div>
  );
}

export default function StrategySignalsPage() {
  const { data: signals, isLoading } = useSignals({ limit: 200 });
  const { data: closedSignals, isLoading: closedLoading } = useClosedSignals({
    limit: 200,
  });
  const [tab, setTab] = useState("candidates");

  const strategySignals = useMemo(
    () => (signals ?? []).filter(isStrategySignal),
    [signals]
  );
  const strategyClosed = useMemo(
    () => (closedSignals ?? []).filter(isStrategySignal),
    [closedSignals]
  );
  const candidates = strategySignals.filter((signal) => signal.status === "pending");
  const executed = strategySignals.filter((signal) => signal.status === "executed");
  const rejected = strategySignals.filter(
    (signal) => signal.status === "rejected" || signal.status === "expired"
  );
  const wins = strategyClosed.filter((signal) => signal.isWin === true);
  const returns = strategyClosed
    .map((signal) => Number(signal.realizedPnl ?? 0))
    .filter(Number.isFinite);
  const totalReturn = returns.reduce((sum, value) => sum + value, 0);
  const winRate = strategyClosed.length ? (wins.length / strategyClosed.length) * 100 : 0;

  if (isLoading || closedLoading) {
    return (
      <PageLayout title="Strategy Signals">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Link href="/strategy-builder">
            <Button size="sm" variant="outline">
              Strategy <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </Link>
          <Link href="/auto-trading">
            <Button size="sm">
              Execution <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </Link>
        </div>
      }
      subtitle="Только WIF/DOT события, созданные детерминированным strategy runner"
      title="Strategy Signals"
    >
      <StatRow className="md:grid-cols-5">
        <StatItem label="Candidates" value={candidates.length} />
        <StatItem label="Executed" value={executed.length} />
        <StatItem label="Closed" value={strategyClosed.length} />
        <StatItem label="Win rate" value={strategyClosed.length ? `${winRate.toFixed(1)}%` : "—"} />
        <StatItem
          label="Closed return"
          value={strategyClosed.length ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%` : "—"}
        />
      </StatRow>

      <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <RadioTower className="mt-0.5 size-5 text-primary" />
          <div>
            <p className="font-medium text-sm">Pending = shadow candidate</p>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Универсальных AI-сигналов на этом экране нет. Pending создаётся scanner,
              а исполнение разрешается только при активной стратегии, Binance account и
              execution preflight.
            </p>
          </div>
        </div>
      </div>

      <Tabs className="mt-4" onValueChange={setTab} value={tab}>
        <TabsList>
          <TabsTrigger value="candidates">Candidates ({candidates.length})</TabsTrigger>
          <TabsTrigger value="executed">Executed ({executed.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({strategyClosed.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>

        <TabsContent className="mt-4" value="candidates">
          <TerminalPanel subtitle="Shadow and pending" title="Candidates">
            {candidates.length ? (
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {candidates.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            ) : (
              <EmptyState
                text="Scanner не нашёл полного набора условий WIF/DOT. Это нормальный режим селективной стратегии."
                title="Активных кандидатов нет"
              />
            )}
          </TerminalPanel>
        </TabsContent>

        <TabsContent className="mt-4" value="executed">
          <TerminalPanel subtitle="Open or executed orders" title="Executed">
            {executed.length ? (
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {executed.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            ) : (
              <EmptyState
                text="Исполнение появится после прохождения preflight и включения execution."
                title="Исполненных сигналов нет"
              />
            )}
          </TerminalPanel>
        </TabsContent>

        <TabsContent className="mt-4" value="closed">
          <TerminalPanel subtitle="Realized strategy trades" title="Closed Trades">
            {strategyClosed.length ? (
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {strategyClosed.map((signal) => (
                  <div className="rounded-xl border bg-card/70 p-4" key={signal.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{moduleTitle(signal)}</Badge>
                          <span className="font-mono text-xs">{signal.symbol}</span>
                        </div>
                        <p className="mt-2 text-muted-foreground text-xs">
                          {signal.entryPrice ?? "—"} → {signal.exitPrice ?? "—"}
                        </p>
                      </div>
                      <div
                        className={`font-mono text-xl ${
                          signal.isWin ? "text-primary" : "text-destructive"
                        }`}
                      >
                        {Number(signal.realizedPnl ?? 0) >= 0 ? "+" : ""}
                        {Number(signal.realizedPnl ?? 0).toFixed(2)}%
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-border/60 border-t pt-3 text-[10px] text-muted-foreground">
                      <span>
                        HOLD {signal.holdingPeriodMinutes ?? "—"}m
                      </span>
                      <span>{signal.exitAt ? new Date(signal.exitAt).toLocaleString("ru-RU") : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                text="Закрытые сделки появятся после реального или testnet исполнения."
                title="Закрытых сделок нет"
              />
            )}
          </TerminalPanel>
        </TabsContent>

        <TabsContent className="mt-4" value="rejected">
          <TerminalPanel subtitle="Skipped, rejected and expired" title="Rejected">
            {rejected.length ? (
              <div className="grid gap-3 p-3 xl:grid-cols-2">
                {rejected.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            ) : (
              <EmptyState
                text="Здесь появятся кандидаты, остановленные execution guardrails или истёкшие до входа."
                title="Отклонённых сигналов нет"
              />
            )}
          </TerminalPanel>
        </TabsContent>
      </Tabs>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
        <TriangleAlert className="mt-0.5 size-5 text-yellow-500" />
        <div>
          <p className="font-medium text-sm">Performance считается только по закрытым strategy trades</p>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            Общие news/LLM/legacy signals исключены из локальных показателей этого экрана.
            Forward gate требует минимум 30 новых сделок и положительный результат без
            трёх лучших.
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
