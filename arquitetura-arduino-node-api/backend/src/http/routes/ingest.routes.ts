import { Router } from "express";
import { CreateRoutesOptions } from "./types";
import { HttpIntake } from "../httpIntake";

/**
 * Endpoint de ingestao para o ESP32 (Wi-Fi).
 *
 * Fluxo:
 *   ESP32 --HTTP POST JSON--> /ingest/sensor
 *   route -> sensorDataService.processJsonPayload()
 *   sensorDataService -> metricsService + experimentService + websocket
 *
 * Tambem expoe GET /config?deviceId=... para o ESP32 puxar o intervalMs
 * vigente no boot, sem precisar reflashar.
 */
export function createIngestRouter(options: CreateRoutesOptions): Router {
  const router = Router();

  router.post("/ingest/sensor", (request, response) => {
    const payload = request.body as Record<string, unknown> | null;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      response.status(400).json({ accepted: false, reason: "invalid_body" });
      return;
    }

    const result = options.sensorDataService.processJsonPayload(payload);
    const intake = options.serialReader as Partial<HttpIntake>;

    if (!result.accepted) {
      if (typeof intake.markError === "function") {
        intake.markError(result.reason ?? "invalid_payload");
      }
      response.status(400).json({ accepted: false, reason: result.reason });
      return;
    }

    const deviceId = typeof payload.deviceId === "string" ? payload.deviceId : null;
    if (typeof intake.markIngested === "function") {
      intake.markIngested(deviceId);
    }

    response.status(204).end();
  });

  router.get("/config", (_request, response) => {
    const intake = options.serialReader as Partial<HttpIntake>;
    const intervalMs =
      typeof intake.getCurrentIntervalMs === "function"
        ? intake.getCurrentIntervalMs()
        : 100;
    response.json({ intervalMs });
  });

  return router;
}
