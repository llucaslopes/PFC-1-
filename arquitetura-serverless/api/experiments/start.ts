import { performance } from "node:perf_hooks";
import { setJson, resetMetrics, resetSamples } from "../../lib/storage.js";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../../lib/auth.js";
import { normalizeSource } from "../../lib/experiment-config.js";

// POST /api/experiments/start. Equivalente serverless da rota de mesmo
// nome no backend Node, porem sem estado em memoria: cada invocacao
// pode cair em um container diferente, entao o "experimento corrente"
// e o intervalMs precisam ser persistidos no Vercel KV. O `deviceId`
// faz parte da chave usada no reset das amostras para que campanhas
// concorrentes (cenarios paralelos com dispositivos diferentes) nao
// se sobrescrevam.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }
  if (!checkApiKey(req, res)) return;

  const requested = (req.body ?? {}) as Record<string, unknown>;
  const sendIntervalMs = Math.max(1, Number(requested.sendIntervalMs) || 100);
  const durationSeconds = Math.max(1, Number(requested.durationSeconds) || 60);
  const replicationNumber = Number(requested.replicationNumber) || 1;
  const deviceId = typeof requested.deviceId === "string" ? requested.deviceId : "esp32-01";
  const source = normalizeSource(requested.source);

  await Promise.all([resetMetrics(), resetSamples(deviceId)]);

  const experiment = {
    id: `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: "running" as const,
    architecture: "serverless" as const,
    source,
    communicationMode: "serverless-http" as const,
    sendIntervalMs,
    durationSeconds,
    replicationNumber,
    deviceId,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    serverlessRegion: process.env.VERCEL_REGION ?? null,
    moduleUptimeMs: Number(performance.now().toFixed(3))
  };

  await Promise.all([
    setJson("experiment:current", experiment),
    setJson("config:intervalMs", sendIntervalMs)
  ]);

  res.status(201).json(experiment);
}
