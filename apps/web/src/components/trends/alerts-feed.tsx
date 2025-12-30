"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Bell,
  Check,
  Clock,
  Flame,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAlerts } from "@/hooks/use-trends";
import { cn } from "@/lib/utils";

function getSeverityStyle(severity: string) {
  switch (severity) {
    case "critical":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "high":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "medium":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    default:
      return "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  }
}

function getAlertIcon(type: string) {
  switch (type) {
    case "spike":
      return <TrendingUp className="h-4 w-4 text-emerald-400" />;
    case "sentiment_shift":
      return <Flame className="h-4 w-4 text-orange-400" />;
    case "new_entity":
      return <Bell className="h-4 w-4 text-blue-400" />;
    default:
      return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  }
}

export function AlertsFeed() {
  const { alerts, loading, error, acknowledgeAlert, refetch } = useAlerts({
    limit: 20,
    unacknowledged: true,
  });

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-zinc-100">Active Alerts</CardTitle>
          </div>
          <Button
            className="text-zinc-400"
            onClick={refetch}
            size="sm"
            variant="ghost"
          >
            Refresh
          </Button>
        </div>
        <CardDescription className="text-zinc-500">
          Real-time anomaly detection alerts
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                className="h-20 animate-pulse rounded-lg bg-zinc-800/50"
                key={i}
              />
            ))}
          </div>
        ) : error ? (
          <div className="py-8 text-center text-red-400">
            Failed to load alerts
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-8 text-center text-zinc-500">
            <Check className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
            No active alerts
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div
                className={cn(
                  "rounded-lg border border-zinc-800 p-4 transition-all",
                  alert.severity === "critical" &&
                    "border-red-500/30 bg-red-500/5",
                  alert.severity === "high" &&
                    "border-orange-500/30 bg-orange-500/5"
                )}
                key={alert.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {getAlertIcon(alert.alertType)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-zinc-100">
                          {alert.title}
                        </span>
                        <Badge
                          className={getSeverityStyle(alert.severity)}
                          variant="outline"
                        >
                          {alert.severity}
                        </Badge>
                      </div>
                      {alert.description && (
                        <p className="mt-1 text-sm text-zinc-400">
                          {alert.description}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(new Date(alert.createdAt), {
                          addSuffix: true,
                        })}
                        <span>•</span>
                        <span className="text-zinc-400">{alert.tagName}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    className="text-zinc-400 hover:text-zinc-100"
                    onClick={() => acknowledgeAlert(alert.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
