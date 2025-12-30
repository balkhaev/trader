"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageLayout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { TerminalPanel } from "@/components/ui/terminal-panel";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type BacktestStatus = "running" | "completed" | "error" | "not_found";

export default function RunningBacktestPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<BacktestStatus>("running");
  const [resultId, setResultId] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let isClosed = false;

    const eventSource = new EventSource(
      `${API_URL}/api/lean/backtest/${id}/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("log", (event) => {
      setLogs((prev) => [...prev, event.data]);
    });

    eventSource.addEventListener("done", async (event) => {
      isClosed = true;
      setLogs((prev) => [...prev, `\n${event.data}`]);
      setStatus("completed");
      eventSource.close();

      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const res = await fetch(
          `${API_URL}/api/backtests?sortBy=date&sortOrder=desc`
        );
        if (res.ok) {
          const backtests = await res.json();
          if (backtests.length > 0) {
            setResultId(backtests[0].id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch backtests:", error);
      }
    });

    eventSource.addEventListener("error", (event) => {
      if (isClosed) return;

      const data = (event as MessageEvent).data;
      if (data?.includes("not found")) {
        setStatus("not_found");
      } else {
        setLogs((prev) => [...prev, `[ERROR] ${data || "Connection error"}`]);
        setStatus("error");
      }
      eventSource.close();
    });

    eventSource.onerror = () => {
      if (isClosed) return;
      eventSource.close();
    };

    return () => {
      isClosed = true;
      eventSource.close();
    };
  }, [id]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const statusConfig = {
    running: { label: "Running", color: "bg-yellow-500", animate: true },
    completed: { label: "Completed", color: "bg-green-500", animate: false },
    error: { label: "Error", color: "bg-red-500", animate: false },
    not_found: { label: "Not Found", color: "bg-muted", animate: false },
  };

  const currentStatus = statusConfig[status];

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${currentStatus.color} ${currentStatus.animate ? "animate-pulse" : ""}`}
            />
            <span className="font-medium text-xs">{currentStatus.label}</span>
          </div>
          {resultId && (
            <Button
              onClick={() => router.push(`/backtests/${resultId}`)}
              size="sm"
            >
              View Results
            </Button>
          )}
        </div>
      }
      backLink={{ href: "/backtests", label: "Backtests" }}
      title="Backtest Execution"
    >
      <div className="space-y-4">
        <TerminalPanel subtitle={`${logs.length} lines`} title="Live Logs">
          <div className="h-[500px] overflow-auto bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap font-mono text-xs">
              {logs.length === 0 && status === "running" ? (
                <span className="text-muted-foreground">
                  Waiting for logs...
                </span>
              ) : (
                logs.map((log, i) => (
                  <div
                    className={
                      log.includes("[ERROR]")
                        ? "text-red-500"
                        : log.includes("[DONE]")
                          ? "font-bold text-green-500"
                          : ""
                    }
                    key={i}
                  >
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </pre>
          </div>
        </TerminalPanel>

        {status === "not_found" && (
          <div className="py-8 text-center">
            <p className="text-muted-foreground text-xs">
              Backtest process not found. It may have already finished.
            </p>
            <Link href="/backtests">
              <Button className="mt-4" size="sm" variant="outline">
                View All Backtests
              </Button>
            </Link>
          </div>
        )}

        {status === "completed" && !resultId && (
          <div className="py-8 text-center">
            <p className="text-muted-foreground text-xs">
              Backtest completed. Looking for results...
            </p>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
