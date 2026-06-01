import { Router } from "express";
import { createClockRouter } from "./routes/clock.routes";
import { createDataRouter } from "./routes/data.routes";
import { createExperimentsRouter } from "./routes/experiments.routes";
import { createHealthRouter } from "./routes/health.routes";
import { createMetricsRouter } from "./routes/metrics.routes";
import { CreateRoutesOptions } from "./routes/types";

// Re-exports para callers historicos que importam estes tipos direto
// daqui (existem em scripts/orquestradores externos).
export type { CreateRoutesOptions, SensorInputStatusProvider } from "./routes/types";

// Monta o router agregado preservando a ORDEM original (health primeiro,
// experimentos por ultimo) para evitar surpresas de matching de path.
// O contrato externo (paths, status codes, response bodies) e' identico
// ao da versao monolitica anterior; validado pelas fixtures congeladas
// em `scripts/tests/baselines-backend-api/`.
export function createRoutes(options: CreateRoutesOptions): Router {
  const router = Router();
  router.use(createHealthRouter(options));
  router.use(createDataRouter(options));
  router.use(createClockRouter());
  router.use(createMetricsRouter(options));
  router.use(createExperimentsRouter(options));
  return router;
}
