import { Router } from "express";
import { performance } from "node:perf_hooks";
import { CreateRoutesOptions } from "./types";

// Rotas de saude: GET /health e GET /health/process.
//
// GET /health/process amostra CPU/memoria do processo. Para calcular o
// `cpu.usagePercent` entre amostras consecutivas, mantemos `lastCpuUsage`
// e `lastSampleAt` em fechamento do router (uma instancia por createRoutes).
export function createHealthRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.get("/health", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();

    response.json({
      status: "ok",
      serial: serialStatus,
      websocketClients: options.websocketServer.getConnectedClients()
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

  return router;
}
