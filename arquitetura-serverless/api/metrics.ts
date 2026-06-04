import { getJson, getMetrics } from "../lib/storage.js";
import type { VercelRequest, VercelResponse } from "../lib/auth.js";

// GET /api/metrics
// Snapshot agregado equivalente ao /metrics do backend Node, com a
// adicao de `coldStartMs` (ultimo medido) e `httpStatusDistribution`.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const metrics = await getMetrics();
  const coldStartMs = (await getJson<number>("experiment:cold_start_ms")) ?? null;

  const elapsedSeconds =
    metrics.startedAtMs && metrics.lastReceivedAtMs
      ? Math.max((metrics.lastReceivedAtMs - metrics.startedAtMs) / 1000, 1)
      : 1;

  res.status(200).json({
    startedAt: metrics.startedAtMs ? new Date(metrics.startedAtMs).toISOString() : null,
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    totalMessagesReceived: metrics.totalReceived,
    totalInvalidMessages: metrics.totalInvalid,
    sequenceGapMessages: metrics.sequenceGapMessages,
    lostMessages: metrics.sequenceGapMessages,
    messagesPerSecond: Number((metrics.totalReceived / elapsedSeconds).toFixed(3)),
    averageMessagesPerSecond: Number(
      (metrics.totalReceived / elapsedSeconds).toFixed(3)
    ),
    coldStartMs,
    httpStatusDistribution: {
      "2xx": metrics.httpStatus2xx,
      "4xx": metrics.httpStatus4xx,
      "5xx": metrics.httpStatus5xx
    },
    serverlessConnected: metrics.lastReceivedAtMs !== null
  });
}
