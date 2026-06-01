import { Router } from "express";
import { CreateRoutesOptions } from "./types";

// Rota de snapshot de metricas agregadas. Tambem atualiza o
// experimentService com o snapshot atual (eh um side-effect deliberado:
// usado pelos clientes para "marcar" o ultimo snapshot no experimento
// em andamento).
export function createMetricsRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.get("/metrics", (_request, response) => {
    const serialStatus = options.serialReader.getStatus();
    const snapshot = options.metricsService.getSnapshot(serialStatus.connected);
    options.experimentService.updateMetricsSnapshot(snapshot);
    response.json(snapshot);
  });

  return router;
}
