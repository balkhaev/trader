"use client";

import { Wallet } from "lucide-react";
import {
  AccountCard,
  AccountCardSkeleton,
} from "@/components/dashboard/account-card";
import { AddAccountDialog } from "@/components/dashboard/add-account-dialog";
import { PageLayout } from "@/components/layout/page-layout";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  useDeleteExchangeAccount,
  useExchangeAccounts,
  useExchangeOverview,
} from "@/hooks/use-exchange";

export default function ExchangesPage() {
  const { data: accounts, isLoading: accountsLoading } = useExchangeAccounts();
  const { data: overview, isLoading: overviewLoading } = useExchangeOverview();
  const deleteAccount = useDeleteExchangeAccount();

  const isLoading = accountsLoading || overviewLoading;

  // Merge account data with overview data for balances
  const accountsWithBalances = accounts?.map((account) => {
    const overviewData = overview?.accounts.find(
      (a) => a.accountId === account.id
    );
    return {
      ...account,
      totalBalance: overviewData?.totalBalance,
      unrealizedPnl: overviewData?.unrealizedPnl,
      positionsCount: overviewData?.positionsCount,
    };
  });

  return (
    <PageLayout
      actions={<AddAccountDialog />}
      subtitle="Manage your connected exchange accounts"
      title="Exchanges"
    >
      <TerminalPanel
        subtitle={`${accountsWithBalances?.length || 0} accounts`}
        title="Connected Accounts"
      >
        <div className="grid gap-3 p-2 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <AccountCardSkeleton key={i} />
            ))
          ) : accountsWithBalances?.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
              <Wallet className="mb-3 h-10 w-10 text-muted-foreground" />
              <h3 className="font-semibold">No accounts connected</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Connect your first exchange account to start trading
              </p>
            </div>
          ) : (
            accountsWithBalances?.map((account) => (
              <AccountCard
                account={account}
                key={account.id}
                onDelete={(id) => deleteAccount.mutate(id)}
              />
            ))
          )}
        </div>
      </TerminalPanel>
    </PageLayout>
  );
}
