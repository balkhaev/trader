"use client";

import { FileCode2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageLayout, PageLoading } from "@/components/layout";
import {
  type BacktestConfig,
  BacktestSettingsDialog,
} from "@/components/lean/backtest-settings-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { TerminalPanel } from "@/components/ui/terminal-panel";

interface Strategy {
  name: string;
  path: string;
  hasConfig: boolean;
  lastModified: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningBacktest, setRunningBacktest] = useState<string | null>(null);

  useEffect(() => {
    fetchStrategies();
  }, []);

  async function fetchStrategies() {
    try {
      const res = await fetch(`${API_URL}/api/lean/strategies`);
      if (res.ok) {
        setStrategies(await res.json());
      }
    } catch (error) {
      console.error("Failed to fetch strategies:", error);
    } finally {
      setLoading(false);
    }
  }

  async function runBacktest(strategyName: string, config: BacktestConfig) {
    setRunningBacktest(strategyName);
    try {
      const res = await fetch(`${API_URL}/api/lean/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyName,
          config: Object.keys(config).length > 0 ? config : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        window.location.href = `/backtests/running/${data.backtestId}`;
      }
    } catch (error) {
      console.error("Failed to run backtest:", error);
    } finally {
      setRunningBacktest(null);
    }
  }

  if (loading) {
    return (
      <PageLayout title="Strategies">
        <PageLoading count={6} variant="cards" />
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Strategies">
      {strategies.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {strategies.map((strategy) => (
            <TerminalPanel
              key={strategy.name}
              subtitle={strategy.hasConfig ? "Config" : undefined}
              title={strategy.name}
            >
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  Last modified:{" "}
                  {new Date(strategy.lastModified).toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <Link href={`/strategies/${strategy.name}`}>
                    <Button size="xs" variant="outline">
                      Edit
                    </Button>
                  </Link>
                  <BacktestSettingsDialog
                    isRunning={runningBacktest === strategy.name}
                    onRun={(config) => runBacktest(strategy.name, config)}
                    strategyName={strategy.name}
                    trigger={
                      <Button
                        disabled={runningBacktest === strategy.name}
                        size="xs"
                      >
                        {runningBacktest === strategy.name
                          ? "Running..."
                          : "Run Backtest"}
                      </Button>
                    }
                  />
                </div>
              </div>
            </TerminalPanel>
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2Icon />
            </EmptyMedia>
            <EmptyTitle>No strategies found</EmptyTitle>
            <EmptyDescription>
              Create your first strategy in the Lean project directory.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </PageLayout>
  );
}
