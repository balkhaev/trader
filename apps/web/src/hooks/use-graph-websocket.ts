import { useCallback, useEffect, useRef, useState } from "react";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000";

interface GraphUpdate {
  type:
    | "node_added"
    | "node_updated"
    | "edge_added"
    | "edge_updated"
    | "alert"
    | "connected"
    | "pong";
  data?: {
    id?: string;
    name?: string;
    nodeType?: string;
    sourceId?: string;
    targetId?: string;
    strength?: number;
    alertType?: string;
    severity?: string;
    message?: string;
  };
  clientId?: string;
  message?: string;
  timestamp?: string;
}

interface UseGraphWebSocketOptions {
  onNodeAdded?: (data: { id: string; name: string; type: string }) => void;
  onNodeUpdated?: (data: { id: string; name: string; type: string }) => void;
  onEdgeAdded?: (data: {
    sourceId: string;
    targetId: string;
    strength: number;
  }) => void;
  onAlert?: (data: {
    alertType: string;
    severity: string;
    message: string;
  }) => void;
  autoConnect?: boolean;
}

export function useGraphWebSocket(options: UseGraphWebSocketOptions = {}) {
  const {
    onNodeAdded,
    onNodeUpdated,
    onEdgeAdded,
    onAlert,
    autoConnect = true,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<GraphUpdate | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const subscribedEntitiesRef = useRef<Set<string>>(new Set());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(`${WS_URL}/api/trends/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[GraphWS] Connected");
        setIsConnected(true);

        // Resubscribe to entities
        for (const entityId of subscribedEntitiesRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", entityId }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const update: GraphUpdate = JSON.parse(event.data);
          setLastUpdate(update);

          switch (update.type) {
            case "node_added":
              if (onNodeAdded && update.data) {
                onNodeAdded({
                  id: update.data.id || "",
                  name: update.data.name || "",
                  type: update.data.nodeType || "",
                });
              }
              break;

            case "node_updated":
              if (onNodeUpdated && update.data) {
                onNodeUpdated({
                  id: update.data.id || "",
                  name: update.data.name || "",
                  type: update.data.nodeType || "",
                });
              }
              break;

            case "edge_added":
              if (onEdgeAdded && update.data) {
                onEdgeAdded({
                  sourceId: update.data.sourceId || "",
                  targetId: update.data.targetId || "",
                  strength: update.data.strength || 0,
                });
              }
              break;

            case "alert":
              if (onAlert && update.data) {
                onAlert({
                  alertType: update.data.alertType || "",
                  severity: update.data.severity || "",
                  message: update.data.message || "",
                });
              }
              break;

            case "connected":
              console.log("[GraphWS] Server welcomed:", update.message);
              break;
          }
        } catch (error) {
          console.error("[GraphWS] Error parsing message:", error);
        }
      };

      ws.onclose = () => {
        console.log("[GraphWS] Disconnected");
        setIsConnected(false);

        // Auto-reconnect after 3 seconds
        if (autoConnect) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("[GraphWS] Attempting reconnect...");
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error("[GraphWS] Error:", error);
      };
    } catch (error) {
      console.error("[GraphWS] Connection error:", error);
    }
  }, [autoConnect, onNodeAdded, onNodeUpdated, onEdgeAdded, onAlert]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const subscribe = useCallback((entityId: string) => {
    subscribedEntitiesRef.current.add(entityId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", entityId }));
    }
  }, []);

  const unsubscribe = useCallback((entityId: string) => {
    subscribedEntitiesRef.current.delete(entityId);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", entityId }));
    }
  }, []);

  const ping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "ping" }));
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Periodic ping to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(ping, 30_000);
    return () => clearInterval(interval);
  }, [isConnected, ping]);

  return {
    isConnected,
    lastUpdate,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
  };
}
