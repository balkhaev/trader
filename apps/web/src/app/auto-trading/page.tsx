"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LockKeyhole,
  Play,
  ServerCog,
  ShieldCheck,
  Square,
  SquareTerminal,
  TriangleAlert,
  WalletCards,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type AutoTradingConfig,
  useAutoTradingConfig,
  useAutoTradingLogs,
  useAutoTradingStats,
  useToggleAutoTrading,
  useUpdateAutoTradingConfig,
} from "@/hooks/use-auto-trading";
import { useExchangeAccounts } from "@/hooks/use-exchange";
import { useCanonicalStrategy } from "@/hooks/use-strategy";

function PreflightRow({
  ok,
  title,
  value,
}: {
  ok: boolean;
  title: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-border/60 border-b py-3 last:border-0">
      <div className="flex items-center gap-2 text-sm">
        {ok ? (
          <CheckCircle2 className="size-4 text-primary" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
        <span>{title}</span>
      </div>
      <span className="font-mono text-muted-foreground text-xs">{value}</span>
    </div>
  );
}

function LogRow({
  log,
}: {
  log: {
    id: string;
    action: "executed" | "skipped" | "error";
    reason: string;
    createdAt: string;
    details: Record<string, unknown> | null;
  };
}) {
  const Icon =
    log.action === "executed"
      ? Activity
      : log.action === "skipped"
        ? Clock3
        : TriangleAlert;

  return (
    <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-border/60 border-b px-3 py-3 last:border-0 hover:bg-muted/20">
      <div className="flex size-8 items-center justify-center rounded-lg bg-muted">
        <Icon
          className={`size-4 ${
            log.action === "executed"
              ? "text-primary"
              : log.action === "error"
                ? "text-destructive"
                : "text-yellow-500"
          }`}
        />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={log.action === "error" ? "destructive" : "secondary"}>
            {log.action}
          </Badge>
          {log.details?.symbol ? (
            <span className="font-mono text-xs">
              {String(log.details.symbol)}
            </span>
          ) : null}
          {log.details?.module ? (
            <span className="font-mono text-[10px] text-muted-foreground uppercase">
              {String(log.details.module)}
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-muted-foreground text-xs">
          {log.reason}
        </p>
      </div>
      <span className="font-mono text-[10px] text-muted-foreground">
        {new Date(log.createdAt).toLocaleTimeString("ru-RU")}
      </span>
    </div>
  );
}

export default function ExecutionConsolePage() {
  const { data: config, isLoading } = useAutoTradingConfig();
  const { data: stats } = useAutoTradingStats();
  const { data: logs } = useAutoTradingLogs(50);
  const { data: accounts } = useExchangeAccounts();
  const canonical = useCanonicalStrategy();
  const update = useUpdateAutoTradingConfig();
  const toggle = useToggleAutoTrading();
  const [local, setLocal] = useState<Partial<AutoTradingConfig>>({});

  if (isLoading || canonical.isLoading || !config || !canonical.data) {
    return (
      <PageLayout title="Execution Console">
        <PageLoading count={6} variant="cards" />
      </PageLayout>
    );
  }

  const strategy = canonical.data;
  const value = <K extends keyof AutoTradingConfig>(key: K) =>
    (local[key] ?? config[key]) as AutoTradingConfig[K];
  const setValue = <K extends keyof AutoTradingConfig>(
    key: K,
    next: AutoTradingConfig[K]
  ) => setLocal((current) => ({ ...current, [key]: next }));

  const selectedAccount = accounts?.find(
    (account) => account.id === value("exchangeAccountId")
  );
  const binanceAccounts =
    accounts?.filter((account) => account.exchange === "binance") ?? [];
  const preflight = {
    strategy: strategy.isActive,
    account: Boolean(selectedAccount),
    binance: selectedAccount?.exchange === "binance",
    testnet: Boolean(selectedAccount?.testnet),
    risk: strategy.config.runtime?.mode !== "stopped",
  };
  const canEnable =
    preflight.strategy &&
    preflight.account &&
    preflight.binance &&
    preflight.risk;

  const save = () => {
    update.mutate(local, {
      onSuccess: () => {
        toast.success("Execution guardrails сохранены");
        setLocal({});
      },
      onError: (error) => toast.error(error.message),
    });
  };

  const toggleExecution = () => {
    if (!config.enabled && !canEnable) {
      toast.error(
        "Preflight не пройден: проверьте стратегию и Binance account"
      );
      return;
    }
    toggle.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(
          result.enabled ? "Execution enabled" : "Execution disabled"
        ),
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          {Object.keys(local).length > 0 ? (
            <Button
              disabled={update.isPending}
              onClick={save}
              size="sm"
              variant="outline"
            >
              Сохранить guardrails
            </Button>
          ) : null}
          <Button
            disabled={toggle.isPending}
            onClick={toggleExecution}
            size="sm"
            variant={config.enabled ? "destructive" : "default"}
          >
            {config.enabled ? (
              <Square className="mr-1 size-3.5" />
            ) : (
              <Play className="mr-1 size-3.5" />
            )}
            {config.enabled ? "Остановить" : "Включить execution"}
          </Button>
        </div>
      }
      subtitle="Только Binance USD-M и только сигналы consensus_wif_dot_v1"
      title="Execution Console"
    >
      <section
        className={`overflow-hidden rounded-2xl border ${
          config.enabled
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card/70"
        }`}
      >
        <div className="grid gap-0 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={config.enabled ? "default" : "secondary"}>
                {config.enabled ? "EXECUTION ACTIVE" : "EXECUTION OFF"}
              </Badge>
              <Badge variant="outline">BINANCE USD-M</Badge>
              <Badge variant="outline">WIF + DOT ONLY</Badge>
            </div>
            <h2 className="mt-4 font-semibold text-2xl tracking-tight">
              Execution не выбирает сделки — он исполняет уже проверенное
              решение стратегии.
            </h2>
            <p className="mt-2 max-w-3xl text-muted-foreground text-sm leading-6">
              Quantity, absolute stop, take profit, time exit, gross cap и risk
              mode приходят из активного strategy blueprint. Здесь остаются
              только account, operational caps и журнал исполнения.
            </p>
          </div>
          <div className="border-border/70 border-t bg-background/45 p-5 lg:border-t-0 lg:border-l sm:p-6">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
                <ServerCog className="size-5" />
              </div>
              <div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
                  Engine state
                </div>
                <div className="mt-1 font-mono text-lg">
                  {config.enabled ? "ARMED" : "SAFE"}
                </div>
              </div>
            </div>
            <div className="mt-4 font-mono text-xs text-muted-foreground">
              {selectedAccount
                ? `${selectedAccount.name} · ${selectedAccount.testnet ? "TESTNET" : "LIVE"}`
                : "No Binance account selected"}
            </div>
          </div>
        </div>
      </section>

      <StatRow className="mt-4 md:grid-cols-5">
        <StatItem label="Engine" value={config.enabled ? "ARMED" : "OFF"} />
        <StatItem label="Executed today" value={stats?.todayExecuted ?? 0} />
        <StatItem label="Skipped today" value={stats?.todaySkipped ?? 0} />
        <StatItem label="Errors today" value={stats?.todayErrors ?? 0} />
        <StatItem
          label="Strategy mode"
          value={(strategy.config.runtime?.mode ?? "base").toUpperCase()}
        />
      </StatRow>

      {config.enabled ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 text-yellow-500" />
          <div>
            <p className="font-medium text-sm">Execution активен</p>
            <p className="mt-1 text-muted-foreground text-xs leading-5">
              Движок принимает только webhook-сигналы с strategyKind
              consensus_wif_dot_v1 и symbols WIFUSDT/DOTUSDT. При сбое
              постановки защиты стратегия выполняет emergency flatten.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <TerminalPanel title="Preflight">
            <div className="p-4">
              <PreflightRow
                ok={preflight.strategy}
                title="Canonical strategy"
                value={preflight.strategy ? "active" : "paused"}
              />
              <PreflightRow
                ok={preflight.account}
                title="Exchange account"
                value={selectedAccount?.name ?? "not selected"}
              />
              <PreflightRow
                ok={preflight.binance}
                title="Venue"
                value={selectedAccount?.exchange ?? "unknown"}
              />
              <PreflightRow
                ok={preflight.testnet}
                title="Environment"
                value={
                  selectedAccount?.testnet
                    ? "testnet"
                    : selectedAccount
                      ? "live"
                      : "unknown"
                }
              />
              <PreflightRow
                ok={preflight.risk}
                title="Risk state"
                value={strategy.config.runtime?.mode ?? "base"}
              />
            </div>
          </TerminalPanel>

          <TerminalPanel title="Operational guardrails">
            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label>Binance USD-M account</Label>
                <Select
                  onValueChange={(next) =>
                    setValue("exchangeAccountId", next === "none" ? null : next)
                  }
                  value={value("exchangeAccountId") ?? "none"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Binance account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No account selected</SelectItem>
                    {binanceAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}{" "}
                        {account.testnet ? "[TESTNET]" : "[LIVE]"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Maximum open positions</Label>
                  <Input
                    max={2}
                    min={1}
                    onChange={(event) =>
                      setValue("maxOpenPositions", event.target.value)
                    }
                    type="number"
                    value={value("maxOpenPositions") ?? "2"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Maximum daily trades</Label>
                  <Input
                    min={1}
                    onChange={(event) =>
                      setValue("maxDailyTrades", event.target.value)
                    }
                    type="number"
                    value={value("maxDailyTrades") ?? "10"}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Optional notional cap per position, USDT</Label>
                <Input
                  min={0}
                  onChange={(event) =>
                    setValue("maxPositionSize", event.target.value)
                  }
                  placeholder="0 = strategy gross cap only"
                  type="number"
                  value={value("maxPositionSize") ?? "0"}
                />
                <p className="text-[10px] text-muted-foreground">
                  Ноль оставляет только внутренний 3× gross cap стратегии.
                </p>
              </div>

              <div className="rounded-xl border bg-background/40 p-3">
                <div className="flex items-center gap-2 font-medium text-sm">
                  <LockKeyhole className="size-4 text-primary" /> Strategy-owned
                  risk
                </div>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Stop-risk, stop price, target, time exit, boost, de-risk и
                  hard stop не редактируются на execution-экране.
                </p>
              </div>
            </div>
          </TerminalPanel>

          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 size-5 text-primary" />
              <div>
                <p className="font-medium text-sm">
                  Рекомендуемый порядок запуска
                </p>
                <p className="mt-1 text-muted-foreground text-xs leading-5">
                  Binance testnet → shadow scan → execution enabled → scheduler
                  opt-in. Live account не является default-сценарием.
                </p>
              </div>
            </div>
          </div>
        </div>

        <TerminalPanel
          action={
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase">
              <SquareTerminal className="size-3.5" /> polling 30s
            </div>
          }
          subtitle={`${logs?.logs.length ?? 0} latest events`}
          title="Execution feed"
        >
          <div className="max-h-[720px] overflow-y-auto">
            {logs?.logs.length ? (
              logs.logs.map((log) => <LogRow key={log.id} log={log} />)
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <WalletCards className="size-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm">Execution feed пуст</p>
                <p className="mt-1 max-w-sm text-muted-foreground text-xs">
                  Shadow scan создаёт pending-кандидатов. Реальные execution
                  events появятся только после прохождения preflight.
                </p>
              </div>
            )}
          </div>
        </TerminalPanel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border bg-card/70 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Zap className="size-4 text-primary" /> Entry
          </div>
          <p className="mt-2 text-sm">
            Market order с размером от strategy stop-risk.
          </p>
        </div>
        <div className="rounded-xl border bg-card/70 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ShieldCheck className="size-4 text-primary" /> Protection
          </div>
          <p className="mt-2 text-sm">
            Absolute stop/target и emergency flatten.
          </p>
        </div>
        <div className="rounded-xl border bg-card/70 p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ServerCog className="size-4 text-primary" /> Scheduler
          </div>
          <p className="mt-2 text-sm">
            Выключен без STRATEGY_SCHEDULER_ENABLED=true.
          </p>
        </div>
      </div>
    </PageLayout>
  );
}
