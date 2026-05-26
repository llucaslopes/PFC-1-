import { Router } from "express";
import { ExperimentService } from "../services/experimentService";
import { MetricsService } from "../services/metricsService";
import { SensorDataService } from "../services/sensorDataService";
import { SensorWebSocketServer } from "../websocket/websocketServer";
import { SerialStatus } from "../types";

interface SensorInputStatusProvider {
  getStatus: () => SerialStatus;
  setIntervalMs?: (intervalMs: number) => void;
}

interface CreateRoutesOptions {
  metricsService: MetricsService;
  experimentService: ExperimentService;
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
    const snapshot = options.metricsService.getSnapshot(serialStatus.connected);
    options.experimentService.updateMetricsSnapshot(snapshot);
    response.json(snapshot);
  });

  router.post("/experiments/start", (request, response) => {
    const experiment = options.experimentService.start(request.body ?? {});

    options.serialReader.setIntervalMs?.(experiment.sendIntervalMs);

    response.status(201).json(experiment);
  });

  router.post("/experiments/stop", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();
    const experiment = options.experimentService.stop(serialStatus.connected);

    if (!experiment) {
      response.status(404).json({ message: "Nenhum experimento iniciado." });
      return;
    }

    response.json(experiment);
  });

  router.post("/experiments/reset", (_request, response) => {
    options.experimentService.reset();
    response.status(204).end();
  });

  router.get("/experiments/current", (_request, response) => {
    const experiment = options.experimentService.getCurrent();

    if (!experiment) {
      response.status(404).json({ message: "Nenhum experimento iniciado." });
      return;
    }

    response.json(experiment);
  });

  router.get("/experiments/export", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();
    options.experimentService.updateMetricsSnapshot(
      options.metricsService.getSnapshot(serialStatus.connected)
    );
    const exportedExperiment = options.experimentService.export();

    if (!exportedExperiment) {
      response.status(404).json({ message: "Nenhum experimento disponivel para exportar." });
      return;
    }

    response.json(exportedExperiment);
  });

  return router;
}
