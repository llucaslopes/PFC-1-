import { Router } from "express";
import { createClockRouter } from "./routes/clock.routes";
import { createDataRouter } from "./routes/data.routes";
import { createExperimentsRouter } from "./routes/experiments.routes";
import { createHealthRouter } from "./routes/health.routes";
import { createIngestRouter } from "./routes/ingest.routes";
import { createMetricsRouter } from "./routes/metrics.routes";
import { CreateRoutesOptions } from "./routes/types";

export type { CreateRoutesOptions, SensorInputStatusProvider } from "./routes/types";

// Ordem: health primeiro (smoke check), ingest depois (caminho quente do
// ESP32), depois data/clock/metrics, experiments por ultimo.
export function createRoutes(options: CreateRoutesOptions): Router {
  const router = Router();
  router.use(createHealthRouter(options));
  router.use(createIngestRouter(options));
  router.use(createDataRouter(options));
  router.use(createClockRouter());
  router.use(createMetricsRouter(options));
  router.use(createExperimentsRouter(options));
  return router;
}
