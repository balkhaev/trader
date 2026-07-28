"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  Play,
  Shield,
  Square,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
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
import { Skeleton } from "@/components/ui/skeleton";
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

function LogRow({
  log,
}: {
  log: {
    action: string;
    reason: string;
    createdAt: string;
    details: Record<string, unknown> | null;
  };
}) {
  const Icon =
    log.action === "executed" ? Check : log.action === "skipped" ? Clock : X;
  return (
    <div className="flex items-center justify-between border-border/50 border-b px-3 py-2 last:border-0">
      <div className="flex items-center gap-3">
        <Icon className="size-4" />
        <div>
          <div className="flex items-center gap-2">
            <Badge
              variant={log.action === "error" ? "destructive" : "secondary"}
            >
              {log.action}
            </Badge>
            {log.details?.symbol && (
              <span className="font-mono text-xs">
                {String(log.details.symbol)}
              </span>
            )}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{log.reason}</p>
        </div>
      </div>
      <span className="text-muted-foreground text-xs">
        {new Date(log.createdAt).toLocaleTimeString("ru-RU")}
      </span>
    </div>
  );
}

export default function AutoTradingPage() {
  const { data: config, isLoading } = useAutoTradingConfig();
  const { data: stats } = useAutoTradingStats();
  const { data: logs } = useAutoTradingLogs(30);
  const { data: accounts } = useExchangeAccounts();
  const update = useUpdateAutoTradingConfig();
  const toggle = useToggleAutoTrading();
  const [local, setLocal] = useState<Partial<AutoTradingConfig>>({});

  if (isLoading) {
    return (
      <PageLayout title="Consensus Execution">
        <Skeleton className="h-96" />
      </PageLayout>
    );
  }

  const value = <K extends keyof AutoTradingConfig>(
    key: K
  ): AutoTradingConfig[K] | undefined =>
    (local[key] ?? config?.[key]) as AutoTradingConfig[K] | undefined;
  const setValue = <K extends keyof AutoTradingConfig>(
    key: K,
    next: AutoTradingConfig[K]
  ) => setLocal((current) => ({ ...current, [key]: next }));

  const save = () => {
    update.mutate(local, {
      onSuccess: () => {
        toast.success("Execution settings saved");
        setLocal({});
      },
      onError: (error) => toast.error(error.message),
    });
  };

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          {Object.keys(local).length > 0 && (
            <Button onClick={save} size="sm">
              Save
            </Button>
          )}
          <Button
            disabled={toggle.isPending}
            onClick={() =>
              toggle.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    result.enabled ? "Execution enabled" : "Execution disabled"
                  ),
              })
            }
            size="sm"
            variant={config?.enabled ? "destructive" : "default"}
          >
            {config?.enabled ? (
              <Square className="mr-1 size-3" />
            ) : (
              <Play className="mr-1 size-3" />
            )}
            {config?.enabled ? "Stop" : "Start"}
          </Button>
        </div>
      }
      subtitle="Binance USD-M execution for deterministic WIF and DOT signals"
      title="Consensus Execution"
    >
      {config?.enabled && (
        <div className="mb-4 flex gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
          <AlertTriangle className="size-5 text-yellow-500" />
          <div>
            <p className="font-medium text-sm">Live execution is enabled</p>
            <p className="text-muted-foreground text-xs">
              Only webhook signals tagged consensus_wif_dot_v1 and symbols
              WIFUSDT/DOTUSDT are accepted.
            </p>
          </div>
        </div>
      )}

      <StatRow>
        <StatItem
          label="Status"
          value={config?.enabled ? "Active" : "Inactive"}
        />
        <StatItem label="Executed today" value={stats?.todayExecuted ?? 0} />
        <StatItem label="Skipped today" value={stats?.todaySkipped ?? 0} />
        <StatItem label="Errors today" value={stats?.todayErrors ?? 0} />
      </StatRow>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <TerminalPanel title="Execution Guardrails">
          <div className="space-y-4 p-3">
            <div className="space-y-1.5">
              <Label>Binance USD-M account</Label>
              <Select
                onValueChange={(next) =>
                  setValue("exchangeAccountId", next === "none" ? null : next)
                }
                value={value("exchangeAccountId") ?? "none"}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No account selected</SelectItem>
                  {accounts
                    ?.filter((account) => account.exchange === "binance")
                    .map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                        {account.testnet ? " [TESTNET]" : ""}
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
                  onChange={(event) =>
                    setValue("maxDailyTrades", event.target.value)
                  }
                  type="number"
                  value={value("maxDailyTrades") ?? "10"}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Optional notional cap per position, USDT</Label>
                <Input
                  onChange={(event) =>
                    setValue("maxPositionSize", event.target.value)
                  }
                  placeholder="0 = strategy gross cap only"
                  type="number"
                  value={value("maxPositionSize") ?? "0"}
                />
              </div>
            </div>

            <div className="rounded border border-border/50 p-3 text-muted-foreground text-xs">
              <div className="mb-2 flex items-center gap-2 text-foreground">
                <Shield className="size-4" /> Risk is not configured here
              </div>
              Position quantity, absolute stop, take profit, 3× gross cap,
              boost/de-risk and hard stop are calculated by the active strategy.
              This page only selects the account and execution limits.
            </div>
          </div>
        </TerminalPanel>

        <TerminalPanel title="Execution Log">
          <div className="max-h-[520px] overflow-y-auto">
            {logs?.logs.length ? (
              logs.logs.map((log) => <LogRow key={log.id} log={log} />)
            ) : (
              <p className="p-4 text-muted-foreground text-sm">
                No execution events yet.
              </p>
            )}
          </div>
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
