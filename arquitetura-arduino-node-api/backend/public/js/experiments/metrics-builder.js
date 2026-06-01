
/**
 * Construtores de metricas e CSVs do frontend backend client.
 * Extraido de `experiments.js` (Sub-fase 3.3).
 *
 * Mantem schemas bit-a-bit:
 *   - sensor-data CSV: 18 colunas, ordem original.
 *   - metrics CSV: 28 colunas (via createExperimentRunsHeader).
 *   - campaign-summary CSV: idem metrics.
 */

import { LATENCY_METHOD_FALLBACK, LATENCY_METHOD_SYNC } from "../clockSync.js";
import { toCsv } from "../_shared/csv.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  createRawRows,
  createRunSummary,
  createSummaryRow,
  numericStats,
  percent,
  round
} from "../scientific.js";
import { state } from "../state.js";

export function getLatencyType(clockSync) {
  return clockSync?.syncFailed
    ? "relative_fallback"
    : "clock_synchronized_estimated_end_to_end";
}

export function getLatencyMethod(clockSync) {
  return clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC;
}

export function storeCompletedRun(experiment) {
  const samples = [...state.observedSamples];
  const invalidMessages = [...state.invalidMessages];

  const run = {
    experiment,
    samples,
    invalidMessages,
    summary: createRunSummary({
      experiment,
      samples,
      invalidMessages,
      sequenceGapMessages: state.observedSequenceGapMessages
    })
  };

  state.completedRuns.push(run);
  return run;
}

export function createObservedMetrics(experiment) {
  const samples = state.observedSamples;
  const expectedMessages = Math.floor((experiment.durationSeconds * 1000) / experiment.sendIntervalMs);
  const elapsedSeconds = Math.max(
    ((Date.parse(experiment.stoppedAt ?? new Date().toISOString()) - Date.parse(experiment.startedAt)) /
      1000),
    1
  );
  const latencies = numericStats(
    samples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  const missingMessages = Math.max(0, expectedMessages - samples.length);
  const baseline = state.latencyCalibrator?.getBaseline() ?? {
    sendMs: samples[0]?.sendMs ?? null,
    receiveMs: samples[0]?.receiveMs ?? null
  };

  return {
    expectedMessages,
    totalMessagesReceived: samples.length,
    totalInvalidMessages: state.invalidMessages.length,
    missingMessages,
    sequenceGapMessages: state.observedSequenceGapMessages,
    lostMessages: missingMessages,
    averageMessagesPerSecond: round(samples.length / elapsedSeconds),
    throughputPercent: percent(samples.length, expectedMessages),
    missingMessagesPercent: percent(missingMessages, expectedMessages),
    lostMessagesPercent: percent(missingMessages, expectedMessages),
    latencyEstimationMethod: getLatencyMethod(state.clockSync),
    latencyType: state.clockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: state.clockSync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : SCIENTIFIC_CONFIG.latencyMethod,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: state.clockSync,
    latencyBaselineSendMs: baseline.sendMs,
    latencyBaselineReceiveMs: baseline.receiveMs,
    estimatedEndToEndLatencyMs: latencies
  };
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

export function createSensorCsv(experiment) {
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
  const rows = state.completedRuns.length
    ? state.completedRuns.flatMap((run) => createRawRows(run.experiment, run.samples))
    : createRawRows(experiment, state.observedSamples);

  return toCsv([header, ...rows]);
}

export function createMetricsCsv(experiment) {
  const summaries = state.completedRuns.length
    ? addSaturationIndicators(state.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment,
          samples: state.observedSamples,
          invalidMessages: state.invalidMessages,
          sequenceGapMessages: state.observedSequenceGapMessages
        })
      ]);

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}

export function createCampaignSummaryCsv() {
  const summaries = addSaturationIndicators(state.completedRuns.map((run) => run.summary));

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}
