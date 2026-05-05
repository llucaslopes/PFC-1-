import { Router } from "express";
import { MetricsService } from "../services/metricsService";
import { SensorDataService } from "../services/sensorDataService";
import { SensorWebSocketServer } from "../websocket/websocketServer";
import { SerialStatus } from "../types";

interface SensorInputStatusProvider {
  getStatus: () => SerialStatus;
}

interface CreateRoutesOptions {
  metricsService: MetricsService;
  sensorDataService: SensorDataService;
  serialReader: SensorInputStatusProvider;
  websocketServer: SensorWebSocketServer;
}

export function createRoutes(options: CreateRoutesOptions): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();

    response.json({
      status: "ok",
      serial: serialStatus,
      websocketClients: options.websocketServer.getConnectedClients()
    });
  });

  router.get("/data/latest", (_request, response) => {
    const latestMessage = options.sensorDataService.getLatestMessage();

    if (!latestMessage) {
      response.status(404).json({
        message: "Nenhuma mensagem valida recebida ainda."
      });
      return;
    }

    response.json(latestMessage);
  });

  router.get("/metrics", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();
    response.json(options.metricsService.getSnapshot(serialStatus.connected));
  });

  return router;
}
