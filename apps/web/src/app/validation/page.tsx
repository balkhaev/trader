"use client";

import {
  CheckCircle2,
  CircleDashed,
  FlaskConical,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PageLayout, PageLoading, StatItem, StatRow } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import { type Signal, useClosedSignals } from "@/hooks/use-signals";
import {
  useCanonicalStrategy,
  useStartForwardValidation,
} from "@/hooks/use-strategy";

interface StrategyMetadata {
  strategyKind?: string;
  strategySignal?: {
    module?: "wif_oi_flush" | "dot_negative_funding";
  };
  pnlSource?: "income" | "price";
}

function metadata(signal: Signal) {
  return (signal.metadata ?? {}) as StrategyMetadata;
}

function Gate({
  passed,
  label,
  current,
  target,
}: {
  passed: boolean;
  label: string;
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
        <p className="text-sm">{label}</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          CURRENT {current}
        </p>
      </div>
      <Badge variant={passed ? "default" : "outline"}>{target}</Badge>
    </div>
  );
}

export default function ForwardValidationPage() {
  const strategy = useCanonicalStrategy();
  const closed = useClosedSignals({ limit: 500 });
  const start = useStartForwardValidation();

  if (strategy.isLoading || closed.isLoading || !strategy.data) {
    return (
      <PageLayout title="Forward Validation">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const startedAt = strategy.data.config.validation?.startedAt;
  const startedMs = startedAt ? new Date(startedAt).getTime() : Number.POSITIVE_INFINITY;
  const trades = (closed.data ?? []).filter((item) => {
    const info = metadata(item);
    return (
      info.strategyKind === "consensus_wif_dot_v1" &&
      new Date(item.createdAt).getTime() >= startedMs
    );
  });
  const wif = trades.filter(
    (item) => metadata(item).strategySignal?.module === "wif_oi_flush"
  );
  const dot = trades.filter(
    (item) => metadata(item).strategySignal?.module === "dot_negative_funding"
  );
  const returns = trades.map((item) => Number(item.realizedPnl ?? 0));
  const gains = returns.filter((value) => value > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(
    returns.filter((value) => value < 0).reduce((a, b) => a + b, 0)
  );
  const profitFactor = losses > 0 ? gains / losses : gains > 0 ? Infinity : 0;
  const withoutBestThree = [...returns]
    .sort((a, b) => b - a)
    .slice(3)
    .reduce((a, b) => a + b, 0);
  const runtime = strategy.data.config.runtime;
  const drawdown =
    runtime && runtime.highWaterEquity > 0
      ? Math.max(0, (1 - runtime.equity / runtime.highWaterEquity) * 100)
      : 0;
  const reconciled = trades.filter(
    (item) => metadata(item).pnlSource === "income"
  ).length;
  const gates = {
    epoch: Boolean(startedAt),
    trades: trades.length >= 30,
    modules: wif.length > 0 && dot.length > 0,
    profitFactor: profitFactor >= 1.35,
    removeBest: trades.length >= 4 && withoutBestThree > 0,
    drawdown: drawdown < 12,
    reconciliation: trades.length > 0 && reconciled === trades.length,
  };
  const passed = Object.values(gates).every(Boolean);

  const startNew = () => {
    if (
      !confirm(
        "Начать новый forward epoch? Execution должен быть выключен, позиции закрыты, runtime будет сброшен в BASE."
      )
    ) {
      return;
    }
    start.mutate(undefined, {
      onSuccess: () => toast.success("New forward epoch started"),
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Link href="/signals">
            <Button size="sm" variant="outline">Сигналы</Button>
          </Link>
          <Button disabled={start.isPending} onClick={startNew} size="sm">
            <PlayCircle className="mr-1 size-4" />
            {startedAt ? "Restart forward" : "Start forward"}
          </Button>
        </div>
      }
      subtitle="Gate считает только сделки после явного запуска нового epoch"
      title="Forward Validation Gate"
    >
      <section
        className={`overflow-hidden rounded-2xl border ${
          passed ? "border-primary/30 bg-primary/5" : "border-yellow-500/25 bg-card/70"
        }`}
      >
        <div className="grid lg:grid-cols-[1.25fr_0.75fr]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant={passed ? "default" : "secondary"}>
                {passed ? "FORWARD PASSED" : "FORWARD LOCKED"}
              </Badge>
              <Badge variant="outline">
                {Object.values(gates).filter(Boolean).length}/7 gates
              </Badge>
              <Badge variant="outline">NEW EPOCH ONLY</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl">
              Исторические и старые DB-сделки больше не могут открыть boost.
            </h2>
            <p className="mt-2 text-muted-foreground text-sm leading-6">
              Epoch стартует только при выключенном execution и нулевых позициях.
              Одновременно закрытая equity сбрасывается в BASE относительно текущего
              Binance balance.
            </p>
          </div>
          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l">
            <div className="text-[10px] text-muted-foreground uppercase">Epoch</div>
            <div className="mt-2 font-mono text-lg">
              {startedAt ? new Date(startedAt).toLocaleString("ru-RU") : "NOT STARTED"}
            </div>
            <div className="mt-4 font-mono text-3xl">{passed ? "PASS" : "LOCKED"}</div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="Closed" value={trades.length} />
        <StatItem label="WIF / DOT" value={`${wif.length} / ${dot.length}`} />
        <StatItem label="Profit factor" value={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"} />
        <StatItem label="Reconciled" value={`${reconciled}/${trades.length}`} />
        <StatItem label="Runtime DD" value={`${drawdown.toFixed(2)}%`} />
      </StatRow>

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <TerminalPanel title="Evidence gates">
          <div className="p-4">
            <Gate passed={gates.epoch} label="Explicit forward epoch" current={startedAt ? "started" : "missing"} target="REQUIRED" />
            <Gate passed={gates.trades} label="New closed sample" current={`${trades.length}`} target="≥ 30" />
            <Gate passed={gates.modules} label="Both modules" current={`WIF ${wif.length} / DOT ${dot.length}`} target="BOTH > 0" />
            <Gate passed={gates.profitFactor} label="Profit Factor" current={Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"} target="≥ 1.35" />
            <Gate passed={gates.removeBest} label="Without best three" current={`${withoutBestThree >= 0 ? "+" : ""}${withoutBestThree.toFixed(2)}%`} target="> 0" />
            <Gate passed={gates.drawdown} label="Closed-equity drawdown" current={`${drawdown.toFixed(2)}%`} target="< 12%" />
            <Gate passed={gates.reconciliation} label="Exchange income reconciliation" current={`${reconciled}/${trades.length}`} target="100%" />
          </div>
        </TerminalPanel>

        <TerminalPanel subtitle="Operational interpretation" title="What PASS means">
          <div className="space-y-4 p-4">
            <div className="flex gap-3 rounded-xl border bg-background/40 p-4">
              <ShieldCheck className="mt-0.5 size-5 text-primary" />
              <p className="text-muted-foreground text-xs leading-5">
                PASS разрешает обсуждать повышение риска, но не включает boost сам.
                Реальный переход всё равно происходит только после +15% closed-equity
                high-water по алгоритму Risk Accelerator.
              </p>
            </div>
            <div className="flex gap-3 rounded-xl border bg-background/40 p-4">
              <FlaskConical className="mt-0.5 size-5 text-yellow-500" />
              <p className="text-muted-foreground text-xs leading-5">
                P&L должен быть reconciled через Binance income history, включая
                realized PnL, commission и funding. Price fallback не проходит gate.
              </p>
            </div>
          </div>
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
