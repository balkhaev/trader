"use client";

import {
  ExternalLink,
  Plus,
  RefreshCw,
  Send,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageLayout, StatItem, StatRow } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TerminalPanel } from "@/components/ui/terminal-panel";
import {
  type NewsSource,
  useCreateNewsSource,
  useDeleteNewsSource,
  useNewsSources,
  useNewsStats,
  useSyncPresets,
  useUpdateNewsSource,
} from "@/hooks/use-news";
import { useRealtimeStatus } from "@/hooks/use-news-realtime";

const TYPE_LABELS: Record<string, string> = {
  telegram: "Telegram",
  web_scraper: "Web Scraper",
  rss: "RSS",
  api: "API",
  twitter: "Twitter",
};

const TYPE_COLORS: Record<string, string> = {
  telegram: "bg-blue-500/20 text-blue-400",
  web_scraper: "bg-purple-500/20 text-purple-400",
  rss: "bg-orange-500/20 text-orange-400",
  api: "bg-green-500/20 text-green-400",
  twitter: "bg-cyan-500/20 text-cyan-400",
};

const CATEGORY_COLORS: Record<string, string> = {
  crypto: "bg-orange-500/20 text-orange-400",
  stocks: "bg-blue-500/20 text-blue-400",
  forex: "bg-green-500/20 text-green-400",
  macro: "bg-purple-500/20 text-purple-400",
  regulation: "bg-red-500/20 text-red-400",
  technology: "bg-cyan-500/20 text-cyan-400",
};

function SourceRow({
  source,
  onToggle,
  onDelete,
  onEdit,
}: {
  source: NewsSource;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onEdit: (source: NewsSource) => void;
}) {
  return (
    <TableRow className={source.enabled ? "" : "opacity-50"}>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={source.enabled}
            onCheckedChange={(checked) => onToggle(source.id, checked)}
          />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{source.name}</span>
          {source.config?.channelUsername && (
            <span className="text-muted-foreground text-xs">
              @{source.config.channelUsername}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge className={TYPE_COLORS[source.type] || "bg-gray-500/20"}>
          {TYPE_LABELS[source.type] || source.type}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge
          className={CATEGORY_COLORS[source.category] || "bg-gray-500/20"}
          variant="secondary"
        >
          {source.category}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
        {source.url}
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {source.lastFetchedAt
          ? new Date(source.lastFetchedAt).toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "-"}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button
            className="h-7 w-7 p-0"
            onClick={() => window.open(source.url, "_blank")}
            size="sm"
            variant="ghost"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            className="h-7 w-7 p-0"
            onClick={() => onEdit(source)}
            size="sm"
            variant="ghost"
          >
            <Settings className="h-3 w-3" />
          </Button>
          <Button
            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
            onClick={() => onDelete(source.id)}
            size="sm"
            variant="ghost"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default function NewsSourcesPage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editSource, setEditSource] = useState<NewsSource | null>(null);
  const [newSource, setNewSource] = useState({
    name: "",
    type: "telegram" as const,
    url: "",
    category: "crypto" as const,
    channelUsername: "",
  });

  const { data: sources, isLoading } = useNewsSources();
  const { data: stats } = useNewsStats();
  const { data: realtimeStatus } = useRealtimeStatus();
  const createSource = useCreateNewsSource();
  const updateSource = useUpdateNewsSource();
  const deleteSource = useDeleteNewsSource();
  const syncPresets = useSyncPresets();

  const telegramSources = sources?.filter((s) => s.type === "telegram") || [];
  const webScraperSources =
    sources?.filter((s) => s.type === "web_scraper") || [];
  const otherSources =
    sources?.filter((s) => !["telegram", "web_scraper"].includes(s.type)) || [];

  const handleToggle = (id: string, enabled: boolean) => {
    updateSource.mutate(
      { id, data: { enabled } },
      {
        onSuccess: () =>
          toast.success(enabled ? "Источник включён" : "Источник выключен"),
        onError: () => toast.error("Ошибка обновления"),
      }
    );
  };

  const handleDelete = (id: string) => {
    if (!confirm("Удалить источник?")) return;
    deleteSource.mutate(id, {
      onSuccess: () => toast.success("Источник удалён"),
      onError: () => toast.error("Ошибка удаления"),
    });
  };

  const handleAdd = () => {
    const config =
      newSource.type === "telegram"
        ? { channelUsername: newSource.channelUsername }
        : undefined;

    createSource.mutate(
      {
        name: newSource.name,
        type: newSource.type,
        url: newSource.url,
        category: newSource.category,
        config,
      },
      {
        onSuccess: () => {
          toast.success("Источник добавлен");
          setAddDialogOpen(false);
          setNewSource({
            name: "",
            type: "telegram",
            url: "",
            category: "crypto",
            channelUsername: "",
          });
        },
        onError: () => toast.error("Ошибка добавления"),
      }
    );
  };

  const handleEdit = (source: NewsSource) => {
    setEditSource(source);
  };

  const handleSaveEdit = () => {
    if (!editSource) return;
    updateSource.mutate(
      {
        id: editSource.id,
        data: {
          name: editSource.name,
          url: editSource.url,
          config: editSource.config,
        },
      },
      {
        onSuccess: () => {
          toast.success("Источник обновлён");
          setEditSource(null);
        },
        onError: () => toast.error("Ошибка обновления"),
      }
    );
  };

  const handleSync = () => {
    syncPresets.mutate(undefined, {
      onSuccess: (result) => {
        if (result.added.length > 0 || result.updated.length > 0) {
          toast.success(
            `Добавлено: ${result.added.length}, обновлено: ${result.updated.length}`
          );
        } else {
          toast.info("Все источники актуальны");
        }
      },
      onError: () => toast.error("Ошибка синхронизации"),
    });
  };

  const renderSourcesTable = (
    sourcesList: NewsSource[],
    title: string,
    icon: React.ReactNode
  ) => {
    if (sourcesList.length === 0) return null;

    return (
      <div className="mt-4">
        <TerminalPanel
          icon={icon}
          subtitle={`${sourcesList.length} источников`}
          title={title}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">Вкл</TableHead>
                <TableHead>Название</TableHead>
                <TableHead className="w-[100px]">Тип</TableHead>
                <TableHead className="w-[100px]">Категория</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-[120px]">Посл. запрос</TableHead>
                <TableHead className="w-[100px]">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourcesList.map((source) => (
                <SourceRow
                  key={source.id}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                  onToggle={handleToggle}
                  source={source}
                />
              ))}
            </TableBody>
          </Table>
        </TerminalPanel>
      </div>
    );
  };

  return (
    <PageLayout
      actions={
        <div className="flex items-center gap-2">
          <Button
            className="h-8"
            disabled={syncPresets.isPending}
            onClick={handleSync}
            size="sm"
            variant="outline"
          >
            {syncPresets.isPending ? (
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-3 w-3" />
            )}
            Sync Presets
          </Button>
          <Button
            className="h-8"
            onClick={() => setAddDialogOpen(true)}
            size="sm"
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Source
          </Button>
        </div>
      }
      subtitle="Manage news sources and Telegram channels"
      title="News Sources"
    >
      <StatRow>
        <StatItem label="Total Sources" value={stats?.totalSources || 0} />
        <StatItem label="Telegram" value={telegramSources.length} />
        <StatItem label="Web Scrapers" value={webScraperSources.length} />
        <StatItem
          label="Realtime"
          value={realtimeStatus?.isRunning ? "ON" : "OFF"}
        />
        <StatItem
          label="Telegram Active"
          value={realtimeStatus?.telegramChannels || 0}
        />
        <StatItem
          label="Scrapers Active"
          value={realtimeStatus?.webScraperSources || 0}
        />
      </StatRow>

      {isLoading ? (
        <div className="mt-8 flex items-center justify-center">
          <RefreshCw className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          {renderSourcesTable(
            telegramSources,
            "Telegram Channels",
            <Send className="h-4 w-4" />
          )}
          {renderSourcesTable(
            webScraperSources,
            "Web Scrapers",
            <Settings className="h-4 w-4" />
          )}
          {renderSourcesTable(
            otherSources,
            "Other Sources",
            <Settings className="h-4 w-4" />
          )}
        </>
      )}

      {/* Add Source Dialog */}
      <Dialog onOpenChange={setAddDialogOpen} open={addDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add News Source</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Type</Label>
              <Select
                onValueChange={(v) => {
                  if (v)
                    setNewSource({
                      ...newSource,
                      type: v as "telegram",
                    });
                }}
                value={newSource.type}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="telegram">Telegram Channel</SelectItem>
                  <SelectItem value="web_scraper">Web Scraper</SelectItem>
                  <SelectItem value="rss">RSS Feed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                onChange={(e) =>
                  setNewSource({ ...newSource, name: e.target.value })
                }
                placeholder="Wu Blockchain"
                value={newSource.name}
              />
            </div>
            {newSource.type === "telegram" && (
              <div className="grid gap-2">
                <Label>Channel Username (without @)</Label>
                <Input
                  onChange={(e) => {
                    const username = e.target.value.replace("@", "");
                    setNewSource({
                      ...newSource,
                      channelUsername: username,
                      url: `https://t.me/${username}`,
                    });
                  }}
                  placeholder="wublockchainenglish"
                  value={newSource.channelUsername}
                />
              </div>
            )}
            {newSource.type !== "telegram" && (
              <div className="grid gap-2">
                <Label>URL</Label>
                <Input
                  onChange={(e) =>
                    setNewSource({ ...newSource, url: e.target.value })
                  }
                  placeholder="https://example.com/feed.xml"
                  value={newSource.url}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                onValueChange={(v) => {
                  if (v)
                    setNewSource({
                      ...newSource,
                      category: v as "crypto",
                    });
                }}
                value={newSource.category}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="macro">Macro</SelectItem>
                  <SelectItem value="stocks">Stocks</SelectItem>
                  <SelectItem value="forex">Forex</SelectItem>
                  <SelectItem value="regulation">Regulation</SelectItem>
                  <SelectItem value="technology">Technology</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setAddDialogOpen(false)} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={
                !newSource.name ||
                (newSource.type === "telegram"
                  ? !newSource.channelUsername
                  : !newSource.url) ||
                createSource.isPending
              }
              onClick={handleAdd}
            >
              {createSource.isPending ? "Adding..." : "Add Source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Source Dialog */}
      <Dialog onOpenChange={() => setEditSource(null)} open={!!editSource}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Source</DialogTitle>
          </DialogHeader>
          {editSource && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input
                  onChange={(e) =>
                    setEditSource({ ...editSource, name: e.target.value })
                  }
                  value={editSource.name}
                />
              </div>
              {editSource.type === "telegram" && (
                <div className="grid gap-2">
                  <Label>Channel Username</Label>
                  <Input
                    onChange={(e) => {
                      const username = e.target.value.replace("@", "");
                      setEditSource({
                        ...editSource,
                        url: `https://t.me/${username}`,
                        config: {
                          ...editSource.config,
                          channelUsername: username,
                        },
                      });
                    }}
                    value={editSource.config?.channelUsername || ""}
                  />
                </div>
              )}
              {editSource.type !== "telegram" && (
                <div className="grid gap-2">
                  <Label>URL</Label>
                  <Input
                    onChange={(e) =>
                      setEditSource({ ...editSource, url: e.target.value })
                    }
                    value={editSource.url}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setEditSource(null)} variant="outline">
              Cancel
            </Button>
            <Button disabled={updateSource.isPending} onClick={handleSaveEdit}>
              {updateSource.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
