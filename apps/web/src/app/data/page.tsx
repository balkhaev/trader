"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PageLayout,
  PageLoading,
  StatItem,
  StatRow,
} from "@/components/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TerminalPanel } from "@/components/ui/terminal-panel";

interface SymbolStatus {
  symbol: string;
  available: boolean;
  file_size: number;
  candles_count: number;
  start_date: string | null;
  end_date: string | null;
  last_updated: string | null;
}

interface DataStatus {
  total_symbols: number;
  symbols: SymbolStatus[];
}

const PORTFOLIO_API =
  process.env.NEXT_PUBLIC_PORTFOLIO_API || "http://localhost:8000";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

export default function DataManagerPage() {
  const [status, setStatus] = useState<DataStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [newSymbol, setNewSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${PORTFOLIO_API}/data/status`);
      if (res.ok) {
        setStatus(await res.json());
        setError(null);
      } else {
        setError("Failed to fetch data status");
      }
    } catch {
      setError("Failed to connect to portfolio service");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUpdateAll = async () => {
    setUpdating(true);
    try {
      const res = await fetch(`${PORTFOLIO_API}/data/update`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchStatus();
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleDownload = async (symbol: string) => {
    setDownloading(symbol);
    try {
      const res = await fetch(`${PORTFOLIO_API}/data/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol] }),
      });
      if (res.ok) {
        await fetchStatus();
      }
    } finally {
      setDownloading(null);
    }
  };

  const handleAddSymbol = async () => {
    if (!newSymbol.trim()) return;

    const symbol = newSymbol.toUpperCase().trim();
    setDownloading(symbol);
    try {
      const res = await fetch(`${PORTFOLIO_API}/data/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols: [symbol] }),
      });
      if (res.ok) {
        setNewSymbol("");
        await fetchStatus();
      }
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async (symbol: string) => {
    if (!confirm(`Delete data for ${symbol}?`)) return;

    try {
      const res = await fetch(`${PORTFOLIO_API}/data/symbol/${symbol}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchStatus();
      }
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const handleUpdateSymbol = async (symbol: string) => {
    setDownloading(symbol);
    try {
      const res = await fetch(`${PORTFOLIO_API}/data/update/${symbol}`, {
        method: "POST",
      });
      if (res.ok) {
        await fetchStatus();
      }
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <PageLayout
        subtitle="Manage historical crypto data for backtesting"
        title="Data Manager"
      >
        <PageLoading />
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout
        subtitle="Manage historical crypto data for backtesting"
        title="Data Manager"
      >
        <TerminalPanel title="Error">
          <div className="py-4 text-center">
            <p className="text-destructive text-xs">{error}</p>
            <Button
              className="mt-4"
              onClick={fetchStatus}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        </TerminalPanel>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      actions={
        <Button disabled={updating} onClick={handleUpdateAll} size="sm">
          {updating ? (
            <>
              <Spinner className="mr-2 h-3 w-3" />
              Updating...
            </>
          ) : (
            "Update All"
          )}
        </Button>
      }
      subtitle="Manage historical crypto data for backtesting"
      title="Data Manager"
    >
      <div className="space-y-4">
        {/* Stats */}
        <StatRow>
          <StatItem label="Total Symbols" value={status?.total_symbols || 0} />
          <StatItem
            label="Total Candles"
            value={
              status?.symbols
                .reduce((acc, s) => acc + s.candles_count, 0)
                .toLocaleString() || "0"
            }
          />
          <StatItem
            label="Data Size"
            value={formatBytes(
              status?.symbols.reduce((acc, s) => acc + s.file_size, 0) || 0
            )}
          />
          <StatItem
            label="Date Range"
            value={`${status?.symbols[0]?.start_date || "—"} → ${status?.symbols[0]?.end_date || "—"}`}
          />
        </StatRow>

        {/* Add Symbol */}
        <TerminalPanel title="Add Symbol">
          <div className="flex gap-2">
            <Input
              className="max-w-xs"
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddSymbol()}
              placeholder="BTCUSDT, ETHUSDT..."
              value={newSymbol}
            />
            <Button
              disabled={!newSymbol.trim() || downloading !== null}
              onClick={handleAddSymbol}
              size="sm"
            >
              {downloading === newSymbol.toUpperCase() ? (
                <>
                  <Spinner className="mr-2 h-3 w-3" />
                  Downloading...
                </>
              ) : (
                "Download"
              )}
            </Button>
          </div>
        </TerminalPanel>

        {/* Symbols Table */}
        <TerminalPanel
          subtitle={`${status?.symbols.length || 0} symbols`}
          title="Available Symbols"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Candles</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>End Date</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status?.symbols.map((symbol) => (
                <TableRow key={symbol.symbol}>
                  <TableCell className="font-medium">{symbol.symbol}</TableCell>
                  <TableCell>
                    <Badge
                      variant={symbol.available ? "default" : "destructive"}
                    >
                      {symbol.available ? "Available" : "Missing"}
                    </Badge>
                  </TableCell>
                  <TableCell>{symbol.candles_count.toLocaleString()}</TableCell>
                  <TableCell>{formatBytes(symbol.file_size)}</TableCell>
                  <TableCell>{symbol.start_date || "—"}</TableCell>
                  <TableCell>{symbol.end_date || "—"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {symbol.last_updated || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        disabled={downloading === symbol.symbol}
                        onClick={() => handleUpdateSymbol(symbol.symbol)}
                        size="xs"
                        variant="outline"
                      >
                        {downloading === symbol.symbol ? (
                          <Spinner className="h-3 w-3" />
                        ) : (
                          "Update"
                        )}
                      </Button>
                      <Button
                        onClick={() => handleDelete(symbol.symbol)}
                        size="xs"
                        variant="ghost"
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!status?.symbols || status.symbols.length === 0) && (
                <TableRow>
                  <TableCell
                    className="text-center text-muted-foreground text-xs"
                    colSpan={8}
                  >
                    No data available. Add symbols to get started.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TerminalPanel>
      </div>
    </PageLayout>
  );
}
