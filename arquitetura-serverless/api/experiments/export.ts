import { getJson, getMetrics, listSamples } from "../../lib/storage.js";
import type { VercelRequest, VercelResponse } from "../../lib/auth.js";

// GET /api/experiments/export?deviceId=esp32-01
//
// Equivalente serverless do GET /experiments/export. Devolve um payload
// JSON com sensorDataCsv, metricsCsv e summaryJson para que o
// orquestrador escreva os 4 arquivos canonicos do TCC. Nao executa
// post-processing pesado para nao estourar o budget de uma function.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const deviceId =
    typeof req.query.deviceId === "string" ? req.query.deviceId : "esp32-01";

  const [current, metrics, samples] = await Promise.all([
    getJson<Record<string, unknown>>("experiment:current"),
    getMetrics(),
    listSamples(deviceId, 200_000)
  ]);

  if (!current) {
    res.status(404).json({ message: "Nenhum experimento disponivel para exportar." });
    return;
  }

  const csvHeader =
    "experiment_id,architecture,communication_mode,source,interval_ms,received_at,seq,send_us,hr,ax,ay,az,magnitude,wifi_rssi_dbm,wifi_reconnects,cold_start_ms,serverless_processing_latency_ms";
  const sortedSamples = [...samples].sort((a, b) => a.seq - b.seq);
  const csvLines = sortedSamples.map((s) =>
    [
      current.id,
      current.architecture,
      current.communicationMode,
      current.source,
      current.sendIntervalMs,
      s.receivedAtIso,
      s.seq,
      s.sendUs,
      s.hr,
      s.ax,
      s.ay,
      s.az,
      s.magnitude,
      s.wifiRssiDbm ?? "",
      s.wifiReconnects ?? "",
      s.coldStartMs ?? "",
      s.serverlessProcessingLatencyMs
    ]
      .map((v) => (typeof v === "string" ? v : String(v)))
      .join(",")
  );
  const sensorDataCsv = [csvHeader, ...csvLines].join("\n");

  const expected = Math.floor(
    (Number(current.durationSeconds) || 60) * 1000 / Math.max(1, Number(current.sendIntervalMs) || 100)
  );
  const received = sortedSamples.length;
  const throughputPercent = expected > 0 ? Number(((received / expected) * 100).toFixed(3)) : 0;

  const summary = {
    experimentId: current.id,
    architecture: current.architecture,
    communicationMode: current.communicationMode,
    source: current.source,
    intervalMs: current.sendIntervalMs,
    durationSeconds: current.durationSeconds,
    replicationNumber: current.replicationNumber,
    serverlessRegion: current.serverlessRegion ?? null,
    expectedMessages: expected,
    receivedMessages: received,
    missingMessages: Math.max(0, expected - received),
    sequenceGapMessages: metrics.sequenceGapMessages,
    invalidMessages: metrics.totalInvalid,
    throughputPercent,
    httpStatusDistribution: {
      "2xx": metrics.httpStatus2xx,
      "4xx": metrics.httpStatus4xx,
      "5xx": metrics.httpStatus5xx
    },
    coldStartMs: (await getJson<number>("experiment:cold_start_ms")) ?? null
  };

  res.status(200).json({
    sensorDataCsv,
    metricsCsv:
      "experiment_id,architecture,communication_mode,source,interval_ms,expected_messages,received_messages,missing_messages,throughput_percent,replication_number\n" +
      [
        summary.experimentId,
        summary.architecture,
        summary.communicationMode,
        summary.source,
        summary.intervalMs,
        summary.expectedMessages,
        summary.receivedMessages,
        summary.missingMessages,
        summary.throughputPercent,
        summary.replicationNumber
      ].join(",") +
      "\n",
    summaryJson: JSON.stringify(summary, null, 2)
  });
}
