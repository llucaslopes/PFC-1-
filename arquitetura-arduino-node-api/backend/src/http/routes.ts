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
  synchronizeClock?: (
    attempts?: number,
    targetIntervalMs?: number
  ) => Promise<import("../types").ClockSyncMetadata>;
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

  // Snapshot de uso de CPU/RAM do processo do backend, para campanhas de
  // escalabilidade que precisam correlacionar carga (msg/s, clientes) com
  // consumo de recursos. Inclui delta de CPU desde a ultima chamada para
  // calcular % de uso entre amostras consecutivas.
  let lastCpuUsage = process.cpuUsage();
  let lastSampleAt = performance.now();

  router.get("/health/process", (_request, response) => {
    const nowMs = performance.now();
    const cpuDelta = process.cpuUsage(lastCpuUsage);
    const wallElapsedMs = nowMs - lastSampleAt;
    const userMs = cpuDelta.user / 1000;
    const systemMs = cpuDelta.system / 1000;
    const totalMs = userMs + systemMs;
    const cpuPercent =
      wallElapsedMs > 0 ? Number(((totalMs / wallElapsedMs) * 100).toFixed(3)) : null;

    lastCpuUsage = process.cpuUsage();
    lastSampleAt = nowMs;

    const memory = process.memoryUsage();
    response.json({
      sampledAt: new Date().toISOString(),
      backendNowMs: Number(nowMs.toFixed(3)),
      uptimeSeconds: Number(process.uptime().toFixed(3)),
      cpu: {
        deltaUserMs: Number(userMs.toFixed(3)),
        deltaSystemMs: Number(systemMs.toFixed(3)),
        deltaTotalMs: Number(totalMs.toFixed(3)),
        wallElapsedMs: Number(wallElapsedMs.toFixed(3)),
        usagePercent: cpuPercent
      },
      memory: {
        rssBytes: memory.rss,
        rssMb: Number((memory.rss / 1024 / 1024).toFixed(3)),
        heapUsedBytes: memory.heapUsed,
        heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(3)),
        heapTotalBytes: memory.heapTotal,
        heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(3)),
        externalBytes: memory.external,
        externalMb: Number((memory.external / 1024 / 1024).toFixed(3)),
        arrayBuffersBytes: memory.arrayBuffers,
        arrayBuffersMb: Number((memory.arrayBuffers / 1024 / 1024).toFixed(3))
      },
      websocketClients: options.websocketServer.getConnectedClients(),
      // Contador de rollovers do micros() detectados nesta execucao do
      // backend. Util para orquestradores marcarem campanhas contaminadas.
      arduinoMicrosRolloverCount: options.sensorDataService.getRolloverDetectedCount()
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

    // Ordem importante: o SYNC NTP/Cristian precisa rodar com o Arduino em
    // 100 ms (idle) para nao colidir com a saturacao do TX serial em alta
    // frequencia. O proprio synchronizeClock se encarrega de forcar 100 ms,
    // executar as 10 tentativas, e depois aplicar `requestedIntervalMs`.
    let clockSync;
    if (requestedConfig.source === "serial" && options.serialReader.synchronizeClock) {
      clockSync = await options.serialReader.synchronizeClock(10, requestedIntervalMs);
    } else {
      // Simulador: nao tem porta serial; aplica o intervalo direto.
      options.serialReader.setIntervalMs?.(requestedIntervalMs);
      clockSync = createRelativeFallbackClockSync("simulator_or_sync_not_available", 0);
    }
    // Antes de iniciar uma nova execucao, zera o tracking de rollover para
    // que rollovers de execucoes anteriores nao "vazem" para esta.
    options.sensorDataService.resetRolloverTracking();
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
