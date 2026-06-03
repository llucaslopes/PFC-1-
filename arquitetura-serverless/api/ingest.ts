import { performance } from "node:perf_hooks";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../lib/auth.js";
import { consumeColdStartMs } from "../lib/cold-start.js";
import {
  getMetrics,
  pushSample,
  setJson,
  updateMetrics,
  type StoredSample
} from "../lib/storage.js";
import { validateSensorPayload } from "../lib/validate.js";

// POST /api/ingest
//
// Recebe o payload JSON do ESP32 (ver embedded/esp32_sports_sensor_wifi/),
// valida, persiste em Vercel KV e atualiza contadores agregados.
// Reporta status HTTP correto (200, 400, 401) -- a distribuicao desses
// codigos eh metrica oficial da campanha (http_status_distribution).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handlerStart = performance.now();
  const coldStartMs = consumeColdStartMs(handlerStart);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }

  if (!checkApiKey(req, res)) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const validation = validateSensorPayload(body);

  if (!validation.ok) {
    await updateMetrics((m) => ({
      ...m,
      totalInvalid: m.totalInvalid + 1,
      httpStatus4xx: m.httpStatus4xx + 1
    }));
    res.status(400).json({ accepted: false, reason: validation.reason });
    return;
  }

  const payload = validation.payload;
  const handlerEnd = performance.now();
  const sample: StoredSample = {
    ...payload,
    receivedAtMs: Date.now(),
    receivedAtIso: new Date().toISOString(),
    serverlessProcessingLatencyMs: Number((handlerEnd - handlerStart).toFixed(3)),
    coldStartMs
  };

  await Promise.all([
    pushSample(payload.deviceId, sample),
    setJson(`latest:${payload.deviceId}`, sample),
    updateMetrics((m) => {
      const lastSeq = m.lastSeqByDevice[payload.deviceId] ?? null;
      let gap = m.sequenceGapMessages;
      if (lastSeq !== null && payload.seq > lastSeq + 1) {
        gap += payload.seq - lastSeq - 1;
      }
      return {
        ...m,
        totalReceived: m.totalReceived + 1,
        startedAtMs: m.startedAtMs ?? Date.now(),
        lastReceivedAtMs: Date.now(),
        lastSeqByDevice: {
          ...m.lastSeqByDevice,
          [payload.deviceId]: payload.seq
        },
        sequenceGapMessages: gap,
        httpStatus2xx: m.httpStatus2xx + 1
      };
    })
  ]);

  if (coldStartMs !== null) {
    await setJson("experiment:cold_start_ms", coldStartMs);
  }

  res.status(200).json({
    accepted: true,
    coldStartMs,
    serverlessProcessingLatencyMs: sample.serverlessProcessingLatencyMs
  });
}

// Re-export para evitar warnings de unused import em ambientes de build
// que eliminam helpers nao referenciados.
void getMetrics;
