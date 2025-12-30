"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PageLayout, PageLoading } from "@/components/layout";
import {
  type BacktestConfig,
  BacktestSettingsDialog,
  type StrategyConfig,
} from "@/components/lean/backtest-settings-dialog";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export default function StrategyEditorPage() {
  const params = useParams();
  const router = useRouter();
  const name = params.name as string;

  const [code, setCode] = useState<string>("");
  const [strategyConfig, setStrategyConfig] = useState<StrategyConfig | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    async function fetchStrategy() {
      try {
        const res = await fetch(`${API_URL}/api/strategies/${name}`);
        if (res.ok) {
          const data = await res.json();
          setCode(data.code);
          setStrategyConfig(data.config ?? null);
        }
      } catch (error) {
        console.error("Failed to fetch strategy:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchStrategy();
  }, [name]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/strategies/${name}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.ok) {
        setHasChanges(false);
      }
    } catch (error) {
      console.error("Failed to save strategy:", error);
    } finally {
      setSaving(false);
    }
  }, [name, code]);

  const handleRunBacktest = async (config: BacktestConfig) => {
    if (hasChanges) {
      await handleSave();
    }

    setRunningBacktest(true);
    try {
      const res = await fetch(`${API_URL}/api/lean/backtest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyName: name,
          config: Object.keys(config).length > 0 ? config : undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/backtests/running/${data.backtestId}`);
      }
    } catch (error) {
      console.error("Failed to run backtest:", error);
    } finally {
      setRunningBacktest(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave]);

  if (loading) {
    return (
      <PageLayout
        backLink={{ href: "/strategies", label: "Strategies" }}
        title={name}
      >
        <PageLoading />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <div className="flex gap-2">
          <Button
            disabled={saving || !hasChanges}
            onClick={handleSave}
            size="sm"
            variant="outline"
          >
            {saving ? "Saving..." : "Save"}
          </Button>
          <BacktestSettingsDialog
            isRunning={runningBacktest}
            onRun={handleRunBacktest}
            strategyConfig={strategyConfig}
            strategyName={name}
            trigger={
              <Button disabled={runningBacktest} size="sm">
                {runningBacktest ? "Running..." : "Run Backtest"}
              </Button>
            }
          />
        </div>
      }
      backLink={{ href: "/strategies", label: "Strategies" }}
      title={name}
    >
      <div className="flex flex-col gap-2">
        <TerminalPanel
          contentClassName="p-0"
          subtitle={hasChanges ? "Unsaved changes" : undefined}
          title="main.py"
        >
          <textarea
            className="h-full min-h-[500px] w-full resize-none bg-muted/30 p-3 font-mono text-xs focus:outline-none"
            onChange={(e) => {
              setCode(e.target.value);
              setHasChanges(true);
            }}
            spellCheck={false}
            value={code}
          />
        </TerminalPanel>

        <p className="text-muted-foreground text-xs">
          Tip: Press Cmd/Ctrl+S to save.
        </p>
      </div>
    </PageLayout>
  );
}
