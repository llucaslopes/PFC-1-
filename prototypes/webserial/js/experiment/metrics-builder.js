
/**
 * Construtores de metricas e CSVs do prototipo WebSerial.
 * Extraido de `experiment.js` (Sub-fase 3.4). Schemas preservados bit-a-bit.
 */

import { toCsv } from "../csv.js";
import { percent, serializeStats, stats } from "../metrics.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  createRawRows,
  createRunSummary,
  createSummaryRow,
  numericStats
} from "../scientific.js";
import { experiment, metricsState } from "../state.js";

export function getLatencyType(clockSync) {
  return clockSync?.syncFailed
    ? "relative_fallback"
    : "clock_synchronized_estimated_end_to_end";
}

export function getLatencyMethod(clockSync) {
  return clockSync?.syncFailed
    ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
    : "ntp_style_clock_synchronization";
}

export function createMetricsSnapshot() {
  const elapsedSeconds = experiment.current
    ? Math.max((Date.now() - Date.parse(experiment.current.startedAt)) / 1000, 1)
    : 1;
  const expectedMessages = experiment.current
    ? Math.floor((experiment.current.durationSeconds * 1000) / experiment.current.sendIntervalMs)
    : metricsState.totalMessages + metricsState.invalidMessages + metricsState.sequenceGapMessages;
  const processingStats = stats(metricsState.processingLatencies);
  const latencyStats = numericStats(metricsState.endToEndLatencies);
  const missingMessages = Math.max(0, expectedMessages - metricsState.totalMessages);
  const baseline = metricsState.latencyCalibrator?.getBaseline() ?? {
    sendMs: null,
    receiveMs: null
  };

  return {
    totalMessagesReceived: metricsState.totalMessages,
    totalInvalidMessages: metricsState.invalidMessages,
    missingMessages,
    sequenceGapMessages: metricsState.sequenceGapMessages,
    lostMessages: missingMessages,
    totalSamples: metricsState.totalMessages,
    expectedMessages,
    messagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    averageMessagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    throughputPercent: Number(percent(metricsState.totalMessages, expectedMessages).toFixed(3)),
    missingMessagesPercent: Number(percent(missingMessages, expectedMessages).toFixed(3)),
    lostMessagesPercent: Number(percent(missingMessages, expectedMessages).toFixed(3)),
    invalidMessagesPercent: Number(percent(metricsState.invalidMessages, expectedMessages).toFixed(3)),
    latencyEstimationMethod: getLatencyMethod(experiment.current?.clockSync),
    latencyType: getLatencyType(experiment.current?.clockSync),
    latencyMethod: getLatencyMethod(experiment.current?.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: experiment.current?.clockSync ?? metricsState.clockSync ?? null,
    latencyBaselineSendMs: baseline.sendMs,
    latencyBaselineReceiveMs: baseline.receiveMs,
    estimatedEndToEndLatencyMs: {
      samples: latencyStats.samples,
      average: latencyStats.average,
      min: latencyStats.min,
      max: latencyStats.max,
      standardDeviation: latencyStats.standardDeviation,
      p95: latencyStats.p95
    },
    processingLatencyMs: serializeStats(processingStats),
    heartRate: serializeStats(stats(metricsState.heartRates)),
    accelerationMagnitude: serializeStats(stats(metricsState.accelerationMagnitudes)),
    processingTimeNote:
      "Tempo de processamento local no navegador; a latencia fim a fim e uma estimativa relativa, nao uma latencia absoluta real."
  };
}

export function storeCompletedRun() {
  if (!experiment.current || !experiment.metricsSnapshot) {
    return;
  }

  experiment.completedRuns.push({
    experiment: experiment.current,
    samples: [...experiment.samples],
    invalidMessages: [...experiment.invalidMessages],
    summary: createRunSummary({
      experiment: experiment.current,
      samples: experiment.samples,
      invalidMessages: experiment.invalidMessages,
      sequenceGapMessages: metricsState.sequenceGapMessages
    })
  });
}

export function createExperimentRunsHeader() {
  return [
    "experiment_id",
    "architecture",
    "communication_mode",
    "source",
    "started_at",
    "stopped_at",
    "interval_ms",
    "duration_seconds",
    "expected_messages",
    "received_messages",
    "missing_messages",
    "sequence_gap_messages",
    "throughput_percent",
    "messages_per_second",
    "estimated_latency_avg_ms",
    "estimated_latency_min_ms",
    "estimated_latency_max_ms",
    "estimated_latency_std_ms",
    "estimated_latency_p95_ms",
    "uncertainty_avg_ms",
    "uncertainty_p95_ms",
    "uncertainty_max_ms",
    "invalid_messages",
    "application_version",
    "replication_number",
    "environment",
    "saturation_indicators",
    "saturation_status"
  ];
}

export function createSensorCsv(current) {
  const header = [
    "experiment_id",
    "architecture",
    "communication_mode",
    "source",
    "interval_ms",
    "seq",
    "send_us",
    "frontend_receive_ms",
    "estimated_frontend_send_ms",
    "end_to_end_latency_ms",
    "clock_offset_ms",
    "clock_uncertainty_ms",
    "sync_rtt_ms",
    "latency_method",
    "hr",
    "ax",
    "ay",
    "az"
  ];
  const rows = experiment.completedRuns.length
    ? experiment.completedRuns.flatMap((run) => createRawRows(run.experiment, run.samples))
    : createRawRows(current, experiment.samples);
  return toCsv([header, ...rows]);
}

export function createMetricsCsv(current) {
  const summaries = experiment.completedRuns.length
    ? addSaturationIndicators(experiment.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment: current,
          samples: experiment.samples,
          invalidMessages: experiment.invalidMessages,
          sequenceGapMessages: metricsState.sequenceGapMessages
        })
      ]);

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}

export function createCampaignSummaryCsv() {
  const summaries = addSaturationIndicators(experiment.completedRuns.map((run) => run.summary));

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}
