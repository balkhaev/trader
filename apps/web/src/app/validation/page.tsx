"use client";

import {
  BarChart3,
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  ShieldCheck,
  Target,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import {
  PageLayout,
  PageLoading,
  StatItem,
  StatRow,
} from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import { type Signal, useClosedSignals } from "@/hooks/use-signals";
import { useCanonicalStrategy } from "@/hooks/use-strategy";

interface StrategyMetadata {
  strategyKind?: string;
  strategySignal?: {
    module?: "wif_oi_flush" | "dot_funding_rebound";
  };
}

function strategyMetadata(signal: Signal) {
  return (signal.metadata ?? {}) as StrategyMetadata;
}

function isStrategySignal(signal: Signal) {
  const meta = strategyMetadata(signal);
  return (
    meta.strategyKind === "consensus_wif_dot_v1" ||
    signal.symbol === "WIFUSDT" ||
    signal.symbol === "DOTUSDT"
  );
}

function GateRow({
  passed,
  title,
  current,
  target,
}: {
  passed: boolean;
  title: string;
  current: string;
  target: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-border/60 border-b py-3 last:border-0">
      {passed ? (
        <CheckCircle2 className="size-4 text-primary" />
      ) : (
        <CircleDashed className="size-4 text-muted-foreground" />
      )}
      <div>
        <p className="text-sm">{title}</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          CURRENT {current}
        </p>
      </div>
      <Badge variant={passed ? "default" : "outline"}>{target}</Badge>
    </div>
  );
}

export default function ForwardValidationPage() {
  const canonical = useCanonicalStrategy();
  const { data: closedSignals, isLoading } = useClosedSignals({ limit: 300 });

  if (canonical.isLoading || isLoading || !canonical.data) {
    return (
      <PageLayout title="Forward Validation">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const strategy = canonical.data;
  const closed = (closedSignals ?? []).filter(isStrategySignal);
  const wifTrades = closed.filter(
    (signal) =>
      strategyMetadata(signal).strategySignal?.module === "wif_oi_flush"
  );
  const dotTrades = closed.filter(
    (signal) =>
      strategyMetadata(signal).strategySignal?.module === "dot_funding_rebound"
  );
  const returns = closed
    .map((signal) => Number(signal.realizedPnl ?? 0))
    .filter(Number.isFinite);
  const winners = returns.filter((value) => value > 0);
  const losers = returns.filter((value) => value < 0);
  const grossWin = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  const profitFactor =
    grossLoss > 0 ? grossWin / grossLoss : winners.length ? Infinity : 0;
  const totalReturn = returns.reduce((sum, value) => sum + value, 0);
  const sortedReturns = [...returns].sort((a, b) => b - a);
  const withoutTopThree = sortedReturns
    .slice(3)
    .reduce((sum, value) => sum + value, 0);
  const runtimeDrawdown = (() => {
    const runtime = strategy.config.runtime;
    if (!runtime || runtime.highWaterEquity <= 0) return 0;
    return Math.max(0, (1 - runtime.equity / runtime.highWaterEquity) * 100);
  })();

  const gates = {
    trades: closed.length >= 30,
    modules: wifTrades.length > 0 && dotTrades.length > 0,
    pf: profitFactor >= 1.35,
    removeBest: closed.length >= 4 && withoutTopThree > 0,
    drawdown: runtimeDrawdown < 12,
    strategyActive: strategy.isActive,
  };
  const passedCount = Object.values(gates).filter(Boolean).length;
  const allPassed = Object.values(gates).every(Boolean);

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Link href="/signals">
            <Button size="sm" variant="outline">
              Сигналы
            </Button>
          </Link>
          <Link href="/strategy-builder">
            <Button size="sm">Strategy blueprint</Button>
          </Link>
        </div>
      }
      subtitle="Live/testnet-доказательство перед повышением риска и включением scheduler"
      title="Forward Validation Gate"
    >
      <section
        className={`overflow-hidden rounded-2xl border ${
          allPassed
            ? "border-primary/30 bg-primary/5"
            : "border-yellow-500/25 bg-card/70"
        }`}
      >
        <div className="grid gap-0 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={allPassed ? "default" : "secondary"}>
                {allPassed ? "FORWARD PASSED" : "RESEARCH / TESTNET"}
              </Badge>
              <Badge variant="outline">{passedCount}/6 gates</Badge>
              <Badge variant="outline">NEW FILLS ONLY</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl tracking-tight">
              Исторические 100% не включают boost автоматически.
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-6">
              Переход к базовому accelerator и затем к boost разрешается только
              после новой серии исполнений с измеренными комиссиями,
              проскальзыванием и сохранением edge отдельно у WIF и DOT.
            </p>
          </div>
          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l sm:p-6">
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
              Forward state
            </div>
            <div className="mt-2 font-mono text-3xl">
              {allPassed ? "PASS" : "LOCKED"}
            </div>
            <div className="mt-2 text-muted-foreground text-xs">
              Boost remains{" "}
              {allPassed ? "eligible" : "disabled by evidence gate"}
            </div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="New closed trades" value={closed.length} />
        <StatItem
          label="WIF / DOT"
          value={`${wifTrades.length} / ${dotTrades.length}`}
        />
        <StatItem
          label="Profit factor"
          value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"}
        />
        <StatItem
          label="Closed return"
          value={`${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(2)}%`}
        />
        <StatItem label="Runtime DD" value={`${runtimeDrawdown.toFixed(2)}%`} />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <TerminalPanel subtitle="Все условия обязательны" title="Forward gates">
          <div className="p-4">
            <GateRow
              current={`${closed.length} trades`}
              passed={gates.trades}
              target="≥ 30"
              title="Достаточная новая выборка"
            />
            <GateRow
              current={`WIF ${wifTrades.length} / DOT ${dotTrades.length}`}
              passed={gates.modules}
              target="BOTH > 0"
              title="Оба модуля реально исполнялись"
            />
            <GateRow
              current={
                Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"
              }
              passed={gates.pf}
              target="PF ≥ 1.35"
              title="Общий Profit Factor"
            />
            <GateRow
              current={`${withoutTopThree >= 0 ? "+" : ""}${withoutTopThree.toFixed(2)}%`}
              passed={gates.removeBest}
              target="> 0"
              title="Результат без трёх лучших"
            />
            <GateRow
              current={`${runtimeDrawdown.toFixed(2)}%`}
              passed={gates.drawdown}
              target="< 12%"
              title="Просадка закрытой equity"
            />
            <GateRow
              current={strategy.isActive ? "active" : "paused"}
              passed={gates.strategyActive}
              target="ACTIVE"
              title="Canonical strategy status"
            />
          </div>
        </TerminalPanel>

        <div className="space-y-4">
          <TerminalPanel
            subtitle="Post-selection research snapshot"
            title="Historical evidence"
          >
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="rounded-xl border bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="size-4 text-primary" />
                    <span className="font-medium text-sm">
                      Consensus late year
                    </span>
                  </div>
                  <Badge variant="outline">29 trades</Badge>
                </div>
                <div className="mt-4 font-mono text-3xl">+55.4%</div>
                <p className="mt-1 text-muted-foreground text-xs">
                  Balanced: WIF 3% / DOT 5% / gross 3×
                </p>
              </div>
              <div className="rounded-xl border bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="size-4 text-yellow-500" />
                    <span className="font-medium text-sm">
                      Risk Accelerator
                    </span>
                  </div>
                  <Badge variant="outline">research</Badge>
                </div>
                <div className="mt-4 font-mono text-3xl">+100.0%</div>
                <p className="mt-1 text-muted-foreground text-xs">
                  Fixed late-year upper bound, closed DD 8.34%
                </p>
              </div>
              <div className="rounded-xl border bg-background/40 p-4 sm:col-span-2">
                <div className="flex items-start gap-3">
                  <FlaskConical className="mt-0.5 size-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm">
                      Planning case ≠ historical upside
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs leading-5">
                      При сохранении 75% наблюдаемого edge медианный accelerator
                      был около +37.6%. При сохранении 50% — около +7%. Поэтому
                      100% остаются целевым upside, а не базовым обещанием.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 text-yellow-500" />
              <div>
                <p className="font-medium text-sm">
                  Gate использует только новые закрытые сделки
                </p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Старые backtests не увеличивают progress. Фактические costs
                  должны быть ≤ 24 bps; этот параметр должен подтверждаться
                  execution журналом перед production-допуском.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Текущий разрешённый режим</p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  До полного PASS: testnet или отдельный micro sleeve, scheduler
                  выключен, boost не считается подтверждённым. Hard stop
                  стратегии остаётся sticky.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
