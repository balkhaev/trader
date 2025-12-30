import type { ServerWebSocket } from "bun";
import { EventEmitter } from "events";

interface WsData {
  clientId: string;
  subscriptions: Set<string>;
}

interface GraphUpdate {
  type: "node_added" | "node_updated" | "edge_added" | "edge_updated" | "alert";
  data: {
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
  timestamp: string;
}

// Event emitter for graph updates
export const graphEvents = new EventEmitter();

class GraphWebSocketServer {
  private clients = new Map<string, ServerWebSocket<WsData>>();
  private clientCounter = 0;

  handleOpen(ws: ServerWebSocket<WsData>): void {
    const clientId = `graph_${++this.clientCounter}`;
    ws.data.clientId = clientId;
    ws.data.subscriptions = new Set(["all"]);
    this.clients.set(clientId, ws);

    console.log(`[GraphWS] Client connected: ${clientId}`);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: "connected",
        clientId,
        message: "Connected to Graph Intelligence WebSocket",
      })
    );
  }

  handleMessage(ws: ServerWebSocket<WsData>, message: string | Buffer): void {
    try {
      const data = JSON.parse(message.toString());
      const clientId = ws.data.clientId;

      switch (data.type) {
        case "subscribe":
          // Subscribe to specific entity updates
          if (data.entityId) {
            ws.data.subscriptions.add(`entity:${data.entityId}`);
            console.log(
              `[GraphWS] ${clientId} subscribed to entity:${data.entityId}`
            );
          }
          if (data.clusterId) {
            ws.data.subscriptions.add(`cluster:${data.clusterId}`);
          }
          break;

        case "unsubscribe":
          if (data.entityId) {
            ws.data.subscriptions.delete(`entity:${data.entityId}`);
          }
          if (data.clusterId) {
            ws.data.subscriptions.delete(`cluster:${data.clusterId}`);
          }
          break;

        case "ping":
          ws.send(
            JSON.stringify({
              type: "pong",
              timestamp: new Date().toISOString(),
            })
          );
          break;

        default:
          console.log(`[GraphWS] Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error("[GraphWS] Error parsing message:", error);
    }
  }

  handleClose(ws: ServerWebSocket<WsData>): void {
    const clientId = ws.data.clientId;
    this.clients.delete(clientId);
    console.log(`[GraphWS] Client disconnected: ${clientId}`);
  }

  // Broadcast update to all connected clients
  broadcast(update: GraphUpdate): void {
    const message = JSON.stringify(update);
    let sentCount = 0;

    for (const [, client] of this.clients) {
      try {
        // Check if client is subscribed to this update
        const shouldSend = this.shouldSendToClient(client, update);
        if (shouldSend) {
          client.send(message);
          sentCount++;
        }
      } catch (error) {
        console.error("[GraphWS] Error sending to client:", error);
      }
    }

    if (sentCount > 0) {
      console.log(`[GraphWS] Broadcast ${update.type} to ${sentCount} clients`);
    }
  }

  private shouldSendToClient(
    client: ServerWebSocket<WsData>,
    update: GraphUpdate
  ): boolean {
    const subs = client.data.subscriptions;

    // Always send if subscribed to all
    if (subs.has("all")) return true;

    // Check entity subscription
    if (update.data.id && subs.has(`entity:${update.data.id}`)) return true;

    // Check if related to subscribed entities
    if (update.data.sourceId && subs.has(`entity:${update.data.sourceId}`))
      return true;
    if (update.data.targetId && subs.has(`entity:${update.data.targetId}`))
      return true;

    return false;
  }

  // Get connected client count
  getClientCount(): number {
    return this.clients.size;
  }
}

export const graphWebSocketServer = new GraphWebSocketServer();

// Helper functions to emit graph updates
export const emitNodeAdded = (node: {
  id: string;
  name: string;
  type: string;
}): void => {
  const update: GraphUpdate = {
    type: "node_added",
    data: {
      id: node.id,
      name: node.name,
      nodeType: node.type,
    },
    timestamp: new Date().toISOString(),
  };
  graphWebSocketServer.broadcast(update);
  graphEvents.emit("node:added", node);
};

export const emitNodeUpdated = (node: {
  id: string;
  name: string;
  type: string;
}): void => {
  const update: GraphUpdate = {
    type: "node_updated",
    data: {
      id: node.id,
      name: node.name,
      nodeType: node.type,
    },
    timestamp: new Date().toISOString(),
  };
  graphWebSocketServer.broadcast(update);
  graphEvents.emit("node:updated", node);
};

export const emitEdgeAdded = (edge: {
  sourceId: string;
  targetId: string;
  strength: number;
}): void => {
  const update: GraphUpdate = {
    type: "edge_added",
    data: {
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      strength: edge.strength,
    },
    timestamp: new Date().toISOString(),
  };
  graphWebSocketServer.broadcast(update);
  graphEvents.emit("edge:added", edge);
};

export const emitAlert = (alert: {
  alertType: string;
  severity: string;
  message: string;
  entityId?: string;
}): void => {
  const update: GraphUpdate = {
    type: "alert",
    data: {
      id: alert.entityId,
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
    },
    timestamp: new Date().toISOString(),
  };
  graphWebSocketServer.broadcast(update);
  graphEvents.emit("alert", alert);
};
