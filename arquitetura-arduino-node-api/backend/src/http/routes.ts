import { Router } from "express";
import { performance } from "node:perf_hooks";
import { ExperimentService } from "../services/experimentService";
import { MetricsService } from "../services/metricsService";
import { SensorDataService } from "../services/sensorDataService";
import { SensorWebSocketServer } from "../websocket/websocketServer";
import { SerialStatus } from "../types";

interface SensorInputStatusProvider {
  getStatus: () => SerialStatus;
  setIntervalMs?: (intervalMs: number) => void;
  synchronizeClock?: (attempts?: number) => Promise<import("../types").ClockSyncMetadata>;
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

  router.get("/clock", (_request, response) => {
    response.json({
      backendNowMs: performance.now()
    });
  });

  router.post("/clock/sync", (request, response) => {
    const clientT0 = Number(request.body?.clientT0);
    const backendT1Ms = performance.now();
    const backendT2Ms = performance.now();

    response.json({
      clientT0: Number.isFinite(clientT0) ? clientT0 : null,
      backendT1Ms: Number(backendT1Ms.toFixed(3)),
      backendT2Ms: Number(backendT2Ms.toFixed(3))
    });
  });

  router.get("/metrics", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();
    const snapshot = options.metricsService.getSnapshot(serialStatus.connected);
    options.experimentService.updateMetricsSnapshot(snapshot);
    response.json(snapshot);
  });

  router.post("/experiments/start", async (request, response) => {
    const requestedConfig = request.body ?? {};
    const requestedIntervalMs = Math.max(1, Number(requestedConfig.sendIntervalMs) || 100);

    options.serialReader.setIntervalMs?.(requestedIntervalMs);
    const clockSync =
      requestedConfig.source === "serial" && options.serialReader.synchronizeClock
        ? await options.serialReader.synchronizeClock(10)
        : createRelativeFallbackClockSync("simulator_or_sync_not_available", 0);
    const experiment = options.experimentService.start(requestedConfig, clockSync);

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

  router.post("/experiments/observations", (request, response) => {
    options.experimentService.recordFrontendObservation(request.body ?? {});
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

function createRelativeFallbackClockSync(reason: string, attempts: number): import("../types").ClockSyncMetadata {
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    arduinoRemoteUnit: null,
    backendToFrontendOffsetMs: null,
    backendToFrontendRttMs: null,
    backendToFrontendUncertaintyMs: null,
    frontendBackendOffsetMs: null,
    frontendBackendRttMs: null,
    frontendBackendUncertaintyMs: null,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: null,
    syncFailed: true,
    fallbackReason: reason
  };
}
