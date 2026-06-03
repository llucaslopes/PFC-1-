import { performance } from "node:perf_hooks";
import { setJson, resetMetrics, resetSamples } from "../../lib/storage.js";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../../lib/auth.js";

// POST /api/experiments/start
// Equivalente serverless do POST /experiments/start. Como funcoes serverless
// sao stateless, o "experimento atual" eh persistido no KV.
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

  await Promise.all([resetMetrics(), resetSamples(deviceId)]);

  const experiment = {
    id: `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    status: "running" as const,
    architecture: "serverless" as const,
    source: "wifi-http" as const,
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
