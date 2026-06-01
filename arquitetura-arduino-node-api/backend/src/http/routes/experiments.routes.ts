import { Router } from "express";
import { createRelativeFallbackClockSync } from "./relative-clock-sync";
import { CreateRoutesOptions } from "./types";

// Rotas do ciclo de vida de experimentos: start/stop/reset/current/
// observations/export.
//
// Ordem em /start: a sincronizacao Cristian/NTP eh executada com o
// Arduino em estado idle (100 ms) e *depois* aplicamos o intervalo
// experimental. `synchronizeClock` se encarrega da sequencia para o
// modo `source=serial`; em `simulator` usamos createRelativeFallbackClockSync.
export function createExperimentsRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.post("/experiments/start", async (request, response) => {
    const requestedConfig = request.body ?? {};
    const requestedIntervalMs = Math.max(1, Number(requestedConfig.sendIntervalMs) || 100);

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
