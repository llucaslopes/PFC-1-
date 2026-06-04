import { Router } from "express";
import { createRelativeFallbackClockSync } from "./relative-clock-sync";
import { CreateRoutesOptions } from "./types";

// Ciclo de vida de cada experimento (start/stop/reset/current/
// observations/export). O alinhamento de relogio depende do source:
// no caminho oficial (wifi-http) o ESP32 sincroniza via SNTP no boot e
// `send_us` ja vai em epoch absoluto, entao a sincronizacao em
// /experiments/start so calcula o offset interno do processo Node;
// no caminho legado serial executavamos um handshake SYNC,<id> que
// nao existe mais no firmware atual mas continua disponivel para
// reproduzir campanhas pre-Wi-Fi a partir do git.
export function createExperimentsRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.post("/experiments/start", async (request, response) => {
    const requestedConfig = request.body ?? {};
    const requestedIntervalMs = Math.max(1, Number(requestedConfig.sendIntervalMs) || 100);

    let clockSync;
    const source = String(requestedConfig.source ?? "wifi-http");
    if (source === "serial" && options.serialReader.synchronizeClock) {
      // Caminho legado mantido apenas para reproducao de campanhas
      // antigas via USB. O parametro 10 era o numero de tentativas do
      // handshake serial -- ignorado pelo firmware Wi-Fi atual.
      clockSync = await options.serialReader.synchronizeClock(10, requestedIntervalMs);
    } else if (
      (source === "wifi-http" || source === "simulator-http") &&
      options.serialReader.synchronizeClock
    ) {
      // Tanto ESP32 real quanto o simulador HTTP local enviam send_us
      // em epoch absoluto. Aqui pedimos zero tentativas porque nao ha
      // handshake -- so calculamos o offset Date.now/performance.now
      // do proprio processo Node e propagamos ao experimentService.
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
