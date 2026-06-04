import { performance } from "node:perf_hooks";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../lib/auth.js";
import { consumeColdStartMs } from "../lib/cold-start.js";
import {
  pushSample,
  setJson,
  updateMetrics,
  type MetricsCounters,
  type StoredSample
} from "../lib/storage.js";
import { validateSensorPayload } from "../lib/validate.js";

// Numero de mensagens "puladas" entre o ultimo seq registrado para o
// dispositivo e o seq atual. Funcao pura para deixar a aritmetica
// testavel sem precisar simular o KV nem o request HTTP.
export function gapBetween(previousSeq: number | null, currentSeq: number): number {
  if (previousSeq === null) return 0;
  if (currentSeq <= previousSeq + 1) return 0;
  return currentSeq - previousSeq - 1;
}

// Aplica a atualizacao do contador de metricas para uma amostra aceita.
// Mantido fora do handler para que o callback de updateMetrics fique
// uma linha so e o "como atualizar" tenha um nome.
export function applyAcceptedIngest(
  metrics: MetricsCounters,
  payload: { deviceId: string; seq: number },
  receivedAtMs: number
): MetricsCounters {
  const previousSeq = metrics.lastSeqByDevice[payload.deviceId] ?? null;
  const gap = metrics.sequenceGapMessages + gapBetween(previousSeq, payload.seq);
  return {
    ...metrics,
    totalReceived: metrics.totalReceived + 1,
    startedAtMs: metrics.startedAtMs ?? receivedAtMs,
    lastReceivedAtMs: receivedAtMs,
    lastSeqByDevice: {
      ...metrics.lastSeqByDevice,
      [payload.deviceId]: payload.seq
    },
    sequenceGapMessages: gap,
    httpStatus2xx: metrics.httpStatus2xx + 1
  };
}

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

  const receivedAtMs = sample.receivedAtMs;
  await Promise.all([
    pushSample(payload.deviceId, sample),
    setJson(`latest:${payload.deviceId}`, sample),
    updateMetrics((m) => applyAcceptedIngest(m, payload, receivedAtMs))
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
