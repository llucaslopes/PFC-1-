import { Router } from "express";
import { createRelativeFallbackClockSync } from "./relative-clock-sync";
import { CreateRoutesOptions } from "./types";

// Rotas do ciclo de vida de experimentos: start/stop/reset/current/
// observations/export.
//
// Wi-Fi: nao executamos mais o handshake SYNC,<id> via porta serial. O
// ESP32 sincroniza via SNTP no boot, e a fonte HttpIntake retorna um
// clockSync de fallback indicando que `send_us` ja esta em epoch absoluto.
// O alinhamento backend<->frontend continua sendo feito por POST /clock/sync
// (Cristian) executado pelo cliente antes de iniciar.
export function createExperimentsRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.post("/experiments/start", async (request, response) => {
    const requestedConfig = request.body ?? {};
    const requestedIntervalMs = Math.max(1, Number(requestedConfig.sendIntervalMs) || 100);

    let clockSync;
    const source = String(requestedConfig.source ?? "wifi-http");
    if (source === "serial" && options.serialReader.synchronizeClock) {
      // Caminho legado preservado para reproduzir campanhas antigas com
      // SerialReader/USB. Nao deve ser usado em novas campanhas.
      clockSync = await options.serialReader.synchronizeClock(10, requestedIntervalMs);
    } else if (source === "wifi-http" && options.serialReader.synchronizeClock) {
      // Caminho oficial: HttpIntake.synchronizeClock devolve fallback com
      // syncFailed=false e fallbackReason="wifi_sntp_absolute_epoch".
      clockSync = await options.serialReader.synchronizeClock(0, requestedIntervalMs);
    } else {
      options.serialReader.setIntervalMs?.(requestedIntervalMs);
      clockSync = createRelativeFallbackClockSync("simulator_or_sync_not_available", 0);
    }
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
