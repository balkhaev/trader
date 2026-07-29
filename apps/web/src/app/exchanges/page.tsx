"use client";

import { ShieldCheck, Trash2, WalletCards } from "lucide-react";
import { AddAccountDialog } from "@/components/dashboard/add-account-dialog";
import { PageLayout, PageLoading, StatItem, StatRow } from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useDeleteExchangeAccount,
  useExchangeAccounts,
  useExchangeOverview,
} from "@/hooks/use-exchange";

export default function BinanceAccountsPage() {
  const accounts = useExchangeAccounts();
  const overview = useExchangeOverview();
  const remove = useDeleteExchangeAccount();

  if (accounts.isLoading || overview.isLoading) {
    return (
      <PageLayout title="Binance USD-M">
        <PageLoading count={6} variant="cards" />
      </PageLayout>
    );
  }

  const rows = (accounts.data ?? [])
    .filter((account) => account.exchange === "binance")
    .map((account) => {
      const state = overview.data?.accounts.find(
        (item) => item.accountId === account.id
      );
      return { ...account, state };
    });
  const balance = rows.reduce(
    (sum, row) => sum + Number(row.state?.totalBalance ?? 0),
    0
  );
  const pnl = rows.reduce(
    (sum, row) => sum + Number(row.state?.unrealizedPnl ?? 0),
    0
  );

  return (
    <PageLayout
      actions={<AddAccountDialog />}
      subtitle="Только Binance USD-M Futures; testnet обязателен до forward PASS"
      title="Binance USD-M"
    >
      <StatRow className="md:grid-cols-4">
        <StatItem label="Accounts" value={rows.length} />
        <StatItem label="Wallet balance" value={`${balance.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`} />
        <StatItem label="Unrealized P&L" value={`${pnl >= 0 ? "+" : ""}${pnl.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT`} />
        <StatItem label="Open positions" value={overview.data?.totalPositions ?? 0} />
      </StatRow>

      <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" />
          <p className="text-muted-foreground text-xs leading-5">
            Account подключается только после server-side Futures preflight:
            trading permission, One-way Mode и live/testnet gate. API withdrawal
            permission стратегии не требуется.
          </p>
        </div>
      </div>

      <TerminalPanel
        subtitle={`${rows.length} connected`}
        title="Strategy Accounts"
      >
        {rows.length ? (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <div className="rounded-xl border bg-card/70 p-4" key={row.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                      <WalletCards className="size-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{row.name}</p>
                      <div className="mt-1 flex gap-2">
                        <Badge variant="outline">BINANCE</Badge>
                        <Badge variant={row.testnet ? "secondary" : "destructive"}>
                          {row.testnet ? "TESTNET" : "LIVE"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <Button
                    aria-label="Delete Binance account"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`Удалить ${row.name}?`)) remove.mutate(row.id);
                    }}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-background/40 p-3">
                    <div className="text-[9px] text-muted-foreground uppercase">Balance</div>
                    <div className="mt-1 font-mono text-sm">
                      {Number(row.state?.totalBalance ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} USDT
                    </div>
                  </div>
                  <div className="rounded-lg border bg-background/40 p-3">
                    <div className="text-[9px] text-muted-foreground uppercase">Positions</div>
                    <div className="mt-1 font-mono text-sm">
                      {row.state?.positionsCount ?? 0}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-16 text-center">
            <WalletCards className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-4 font-medium">Binance account не подключён</p>
            <p className="mt-1 text-muted-foreground text-xs">
              Подключите Futures Testnet, затем выберите account в Execution Console.
            </p>
          </div>
        )}
      </TerminalPanel>
    </PageLayout>
  );
}
