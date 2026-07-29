"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  CheckCircle2,
  Clock3,
  RadioTower,
  ShieldCheck,
  Target,
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

interface StrategyPlan {
  module?: "wif_oi_flush" | "dot_negative_funding";
  reason?: string;
  entryPrice?: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  maxHoldMinutes?: number;
  riskPercent?: number;
  cappedNotional?: number;
  quantity?: number;
  maxGrossLeverage?: number;
}

interface StrategyMetadata {
  strategyKind?: string;
  reasoning?: string;
  strategySignal?: StrategyPlan;
  positionPreview?: StrategyPlan;
  positionPlan?: StrategyPlan;
  closeReason?: string;
  pnlSource?: "income" | "price";
}

function meta(signal: Signal) {
  return (signal.metadata ?? {}) as StrategyMetadata;
}

function isStrategySignal(signal: Signal) {
  return meta(signal).strategyKind === "consensus_wif_dot_v1";
}

function moduleName(signal: Signal) {
  const module = meta(signal).strategySignal?.module;
  if (module === "wif_oi_flush") return "WIF OI FLUSH";
  if (module === "dot_negative_funding") return "DOT FUNDING REBOUND";
  return signal.symbol;
}

function TradeCard({ signal }: { signal: Signal }) {
  const metadata = meta(signal);
  const signalPlan = metadata.strategySignal;
  const position = metadata.positionPlan ?? metadata.positionPreview;
  const closed = signal.exitPrice !== null && signal.exitPrice !== undefined;
  const Icon = closed
    ? signal.isWin
      ? CheckCircle2
      : XCircle
    : signal.status === "executed"
      ? Activity
      : Clock3;

  return (
    <div className="rounded-xl border bg-card/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{moduleName(signal)}</Badge>
            <Badge
              variant={
                closed
                  ? signal.isWin
                    ? "default"
                    : "destructive"
                  : signal.status === "executed"
                    ? "default"
                    : "secondary"
              }
            >
              <Icon className="mr-1 size-3" />
              {closed ? "closed" : signal.status}
            </Badge>
          </div>
          <div className="mt-3 font-mono font-semibold text-xl">
            {signal.symbol} <span className="text-muted-foreground text-xs">LONG</span>
          </div>
        </div>
        <div className="text-right">
          {closed ? (
            <div
              className={`font-mono text-2xl ${
                Number(signal.realizedPnl ?? 0) >= 0
                  ? "text-primary"
                  : "text-destructive"
              }`}
            >
              {Number(signal.realizedPnl ?? 0) >= 0 ? "+" : ""}
              {Number(signal.realizedPnl ?? 0).toFixed(2)}%
            </div>
          ) : (
            <>
              <div className="font-mono text-2xl">
                {Number(signal.strength ?? 0).toFixed(0)}
              </div>
              <div className="text-[9px] text-muted-foreground uppercase">
                strength
              </div>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-muted-foreground text-xs leading-5">
        {metadata.reasoning ?? signalPlan?.reason ?? "Deterministic strategy event"}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric
          icon={RadioTower}
          label="Entry"
          value={signal.entryPrice ?? String(position?.entryPrice ?? signalPlan?.entryPrice ?? "—")}
        />
        <Metric
          icon={ArrowDownRight}
          label="Stop"
          value={position?.stopPrice ? String(position.stopPrice) : "—"}
        />
        <Metric
          icon={Target}
          label="Target"
          value={position?.takeProfitPrice ? String(position.takeProfitPrice) : "—"}
        />
        <Metric
          icon={ShieldCheck}
          label="Risk"
          value={position?.riskPercent !== undefined ? `${position.riskPercent}%` : "—"}
        />
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2 border-border/60 border-t pt-3 font-mono text-[10px] text-muted-foreground">
        <div className="flex flex-wrap gap-4">
          {position?.cappedNotional !== undefined ? (
            <span>NOTIONAL {position.cappedNotional.toFixed(2)} USDT</span>
          ) : null}
          {position?.quantity !== undefined ? (
            <span>QTY {position.quantity.toPrecision(6)}</span>
          ) : null}
          {signalPlan?.maxHoldMinutes ? (
            <span>MAX HOLD {signalPlan.maxHoldMinutes}m</span>
          ) : null}
          {closed ? <span>{metadata.closeReason ?? "exchange_exit"}</span> : null}
        </div>
        <span>{new Date(signal.createdAt).toLocaleString("ru-RU")}</span>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-background/40 p-2.5">
      <div className="flex items-center gap-1 text-[9px] text-muted-foreground uppercase">
        <Icon className="size-3" /> {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs">{value}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="py-16 text-center">
      <RadioTower className="mx-auto size-9 text-muted-foreground/40" />
      <p className="mt-3 text-muted-foreground text-sm">{text}</p>
    </div>
  );
}

export default function StrategySignalsPage() {
  const signals = useSignals({ limit: 200 });
  const closed = useClosedSignals({ limit: 200 });
  const [tab, setTab] = useState("candidates");
  const all = useMemo(
    () => (signals.data ?? []).filter(isStrategySignal),
    [signals.data]
  );
  const closedTrades = useMemo(
    () => (closed.data ?? []).filter(isStrategySignal),
    [closed.data]
  );
  const candidates = all.filter((item) => item.status === "pending");
  const open = all.filter(
    (item) => item.status === "executed" && !item.exitPrice
  );
  const rejected = all.filter(
    (item) => item.status === "rejected" || item.status === "expired"
  );
  const wins = closedTrades.filter((item) => item.isWin).length;
  const totalReturn = closedTrades.reduce(
    (sum, item) => sum + Number(item.realizedPnl ?? 0),
    0
  );

  if (signals.isLoading || closed.isLoading) {
    return (
      <PageLayout title="Strategy Signals">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const panel = (rows: Signal[], empty: string) =>
    rows.length ? (
      <div className="grid gap-3 p-3 xl:grid-cols-2">
        {rows.map((item) => (
          <TradeCard key={item.id} signal={item} />
        ))}
      </div>
    ) : (
      <Empty text={empty} />
    );

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Link href="/strategy-builder">
            <Button size="sm" variant="outline">
              Blueprint <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </Link>
          <Link href="/auto-trading">
            <Button size="sm">
              Execution <ArrowRight className="ml-1 size-3.5" />
            </Button>
          </Link>
        </div>
      }
      subtitle="Только metadata.strategyKind = consensus_wif_dot_v1"
      title="Strategy Signals"
    >
      <StatRow className="md:grid-cols-5">
        <StatItem label="Candidates" value={candidates.length} />
        <StatItem label="Open" value={open.length} />
        <StatItem label="Closed" value={closedTrades.length} />
        <StatItem
          label="Win rate"
          value={closedTrades.length ? `${((wins / closedTrades.length) * 100).toFixed(1)}%` : "—"}
        />
        <StatItem
          label="Net return"
          value={closedTrades.length ? `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%` : "—"}
        />
      </StatRow>

      <Tabs className="mt-4" onValueChange={setTab} value={tab}>
        <TabsList>
          <TabsTrigger value="candidates">Candidates ({candidates.length})</TabsTrigger>
          <TabsTrigger value="open">Open ({open.length})</TabsTrigger>
          <TabsTrigger value="closed">Closed ({closedTrades.length})</TabsTrigger>
          <TabsTrigger value="rejected">Rejected ({rejected.length})</TabsTrigger>
        </TabsList>
        <TabsContent className="mt-4" value="candidates">
          <TerminalPanel title="Pending candidates">
            {panel(candidates, "Полный WIF/DOT сигнал не сформирован.")}
          </TerminalPanel>
        </TabsContent>
        <TabsContent className="mt-4" value="open">
          <TerminalPanel title="Open strategy positions">
            {panel(open, "Открытых strategy positions нет.")}
          </TerminalPanel>
        </TabsContent>
        <TabsContent className="mt-4" value="closed">
          <TerminalPanel title="Closed trades">
            {panel(closedTrades, "Закрытых strategy trades пока нет.")}
          </TerminalPanel>
        </TabsContent>
        <TabsContent className="mt-4" value="rejected">
          <TerminalPanel title="Rejected / expired">
            {panel(rejected, "Отклонённых событий нет.")}
          </TerminalPanel>
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
