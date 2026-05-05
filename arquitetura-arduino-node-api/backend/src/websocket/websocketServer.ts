import { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { ProcessedSensorMessage } from "../types";

export class SensorWebSocketServer {
  private readonly websocketServer: WebSocketServer;

  constructor(httpServer: HttpServer) {
    this.websocketServer = new WebSocketServer({ server: httpServer });

    this.websocketServer.on("connection", (client) => {
      client.send(JSON.stringify({ type: "connected", message: "WebSocket conectado ao backend." }));
    });
  }

  broadcastSensorMessage(message: ProcessedSensorMessage): void {
    const payload = JSON.stringify({
      type: "sensor-data",
      data: message
    });

    for (const client of this.websocketServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  getConnectedClients(): number {
    return this.websocketServer.clients.size;
  }
}
