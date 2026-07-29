"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Play,
  ShieldAlert,
  Square,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout, PageLoading, StatItem, StatRow } from "@/components/layout";
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
  useEmergencyStop,
  useExecutionPreflight,
  useToggleAutoTrading,
  useUpdateAutoTradingConfig,
} from "@/hooks/use-auto-trading";
import { useExchangeAccounts } from "@/hooks/use-exchange";
import { useCanonicalStrategy, useStrategyStatus } from "@/hooks/use-strategy";

function CheckRow({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
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
        {label}
      </div>
      <span className="font-mono text-muted-foreground text-xs">{value}</span>
    </div>
  );
}

export default function ExecutionConsolePage() {
  const config = useAutoTradingConfig();
  const preflight = useExecutionPreflight();
  const stats = useAutoTradingStats();
  const logs = useAutoTradingLogs(60);
  const accounts = useExchangeAccounts();
  const strategy = useCanonicalStrategy();
  const scheduler = useStrategyStatus();
  const update = useUpdateAutoTradingConfig();
  const toggle = useToggleAutoTrading();
  const emergency = useEmergencyStop();
  const [local, setLocal] = useState<Partial<AutoTradingConfig>>({});

  if (config.isLoading || strategy.isLoading || !config.data || !strategy.data) {
    return (
      <PageLayout title="Execution Console">
        <PageLoading count={8} variant="cards" />
      </PageLayout>
    );
  }

  const current = <K extends keyof AutoTradingConfig>(key: K) =>
    (local[key] ?? config.data[key]) as AutoTradingConfig[K];
  const set = <K extends keyof AutoTradingConfig>(
    key: K,
    value: AutoTradingConfig[K]
  ) => setLocal((state) => ({ ...state, [key]: value }));
  const binance = (accounts.data ?? []).filter(
    (account) => account.exchange === "binance"
  );
  const checks = preflight.data?.checks;

  const save = () =>
    update.mutate(local, {
      onSuccess: () => {
        setLocal({});
        toast.success("Operational guardrails сохранены");
      },
      onError: (error) => toast.error(error.message),
    });

  const toggleExecution = () =>
    toggle.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(result.enabled ? "Execution armed" : "Execution disabled"),
      onError: (error) => toast.error(error.message),
    });

  const emergencyStop = () => {
    if (!confirm("Отключить execution и закрыть все WIF/DOT позиции market-ордерами?")) {
      return;
    }
    emergency.mutate(undefined, {
      onSuccess: (result) =>
        toast.success(`Emergency stop: закрыто позиций ${result.closed}`),
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <PageLayout
      actions={
        <div className="flex flex-wrap gap-2">
          {Object.keys(local).length ? (
            <Button onClick={save} size="sm" variant="outline">
              Сохранить
            </Button>
          ) : null}
          <Button
            disabled={toggle.isPending || (!config.data.enabled && !preflight.data?.ready)}
            onClick={toggleExecution}
            size="sm"
            variant={config.data.enabled ? "destructive" : "default"}
          >
            {config.data.enabled ? (
              <Square className="mr-1 size-3.5" />
            ) : (
              <Play className="mr-1 size-3.5" />
            )}
            {config.data.enabled ? "Остановить" : "Включить"}
          </Button>
          <Button
            disabled={emergency.isPending}
            onClick={emergencyStop}
            size="sm"
            variant="destructive"
          >
            <ShieldAlert className="mr-1 size-3.5" /> Emergency stop
          </Button>
        </div>
      }
      subtitle="Server-side preflight, Binance USD-M и market-only strategy execution"
      title="Execution Console"
    >
      <StatRow className="md:grid-cols-6">
        <StatItem label="Engine" value={config.data.enabled ? "ARMED" : "OFF"} />
        <StatItem label="Preflight" value={preflight.data?.ready ? "READY" : "BLOCKED"} />
        <StatItem label="Scheduler" value={scheduler.data?.scheduler.enabled ? "ON" : "OFF"} />
        <StatItem label="Executed" value={stats.data?.todayExecuted ?? 0} />
        <StatItem label="Closed" value={stats.data?.todayClosed ?? 0} />
        <StatItem label="Errors" value={stats.data?.todayErrors ?? 0} />
      </StatRow>

      {config.data.enabled ? (
        <div className="mt-4 flex gap-3 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 text-yellow-500" />
          <div>
            <p className="font-medium text-sm">Execution активен</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Runtime принимает только WIFUSDT/DOTUSDT strategy signals. Ручная
              постановка ордеров через API отключена.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="space-y-4">
          <TerminalPanel title="Server Preflight">
            <div className="p-4">
              <CheckRow ok={Boolean(checks?.account)} label="Binance account" value={preflight.data?.account?.name ?? "not selected"} />
              <CheckRow ok={Boolean(checks?.liveAllowed)} label="Environment gate" value={preflight.data?.account?.testnet ? "TESTNET" : "LIVE LOCK"} />
              <CheckRow ok={Boolean(checks?.canTrade)} label="Futures permission" value={checks?.canTrade ? "enabled" : "blocked"} />
              <CheckRow ok={Boolean(checks?.oneWayMode)} label="Position mode" value={checks?.oneWayMode ? "ONE-WAY" : "HEDGE/UNKNOWN"} />
              <CheckRow ok={Boolean(checks?.positionsSafe)} label="Open positions" value={`${preflight.data?.positions ?? 0} safe`} />
              <CheckRow ok={Boolean(checks?.strategyActive)} label="Canonical strategy" value={strategy.data.isActive ? "active" : "paused"} />
              <CheckRow ok={Boolean(checks?.riskState)} label="Risk state" value={strategy.data.config.runtime?.mode ?? "base"} />
              {preflight.data?.reasons.length ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
                  {preflight.data.reasons.join(" · ")}
                </div>
              ) : null}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Operational caps">
            <div className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label>Binance USD-M account</Label>
                <Select
                  onValueChange={(value) =>
                    set("exchangeAccountId", value === "none" ? null : value)
                  }
                  value={current("exchangeAccountId") ?? "none"}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No account selected</SelectItem>
                    {binance.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name} {account.testnet ? "[TESTNET]" : "[LIVE]"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Open positions</Label>
                  <Input
                    max={2}
                    min={1}
                    onChange={(event) => set("maxOpenPositions", event.target.value)}
                    type="number"
                    value={current("maxOpenPositions")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Daily trades</Label>
                  <Input
                    max={20}
                    min={1}
                    onChange={(event) => set("maxDailyTrades", event.target.value)}
                    type="number"
                    value={current("maxDailyTrades")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Notional cap, USDT</Label>
                  <Input
                    min={0}
                    onChange={(event) => set("maxPositionSize", event.target.value)}
                    type="number"
                    value={current("maxPositionSize")}
                  />
                </div>
              </div>
            </div>
          </TerminalPanel>
        </div>

        <TerminalPanel subtitle="executed / closed / skipped / error" title="Execution Feed">
          <div className="max-h-[650px] overflow-y-auto">
            {logs.data?.logs.length ? (
              logs.data.logs.map((log) => {
                const Icon =
                  log.action === "executed" || log.action === "closed"
                    ? Activity
                    : log.action === "skipped"
                      ? Clock3
                      : TriangleAlert;
                return (
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 border-border/60 border-b p-3 last:border-0" key={log.id}>
                    <Icon className={`mt-1 size-4 ${log.action === "error" ? "text-destructive" : "text-primary"}`} />
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant={log.action === "error" ? "destructive" : "secondary"}>{log.action}</Badge>
                        {log.details?.symbol ? <span className="font-mono text-xs">{String(log.details.symbol)}</span> : null}
                      </div>
                      <p className="mt-1 text-muted-foreground text-xs">{log.reason}</p>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">{new Date(log.createdAt).toLocaleTimeString("ru-RU")}</span>
                  </div>
                );
              })
            ) : (
              <div className="py-16 text-center text-muted-foreground text-sm">
                Execution events отсутствуют.
              </div>
            )}
          </div>
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
