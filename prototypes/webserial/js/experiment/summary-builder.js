
/**
 * Monta o JSON exportado em `_experiment-summary.json` do prototipo WebSerial.
 * Extraido de `experiment.js` (Sub-fase 3.4) — schema preservado bit-a-bit.
 */

import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  createExperimentExportBlock,
  createRunSummary,
  createSaturationAnalysis
} from "../scientific.js";
import { experiment, metricsState } from "../state.js";

import {
  createMetricsSnapshot,
  getLatencyMethod,
  getLatencyType
} from "./metrics-builder.js";

export function createSummary(current, { collectExperimentEnvironment, readReplicationNumber }) {
  const metrics = experiment.metricsSnapshot ?? createMetricsSnapshot();
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
  const primarySummary = summaries[0];
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(summaries);
  const campaign = experiment.campaign
    ? {
        ...experiment.campaign,
        stoppedAt: experiment.campaign.stoppedAt,
        applicationVersion: SCIENTIFIC_CONFIG.applicationVersion
      }
    : null;

  return {
    ...exportBlock,
    campaign,
    runs: summaries,
    saturationAnalysis,
    saturation,
    architecture: current.architecture,
    communicationMode: current.communicationMode,
    source: current.source,
    intervalMs: current.sendIntervalMs,
    durationSeconds: current.durationSeconds,
    startedAt: current.startedAt,
    stoppedAt: current.stoppedAt,
    replicationNumber: current.replicationNumber ?? readReplicationNumber(),
    environment: current.environment ?? collectExperimentEnvironment(current),
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: getLatencyType(current.clockSync),
    latencyMethod: getLatencyMethod(current.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: getLatencyMethod(current.clockSync),
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: current.clockSync ?? null,
    latencyBaselineSendMs: primarySummary?.latencyBaselineSendMs ?? null,
    latencyBaselineReceiveMs: primarySummary?.latencyBaselineReceiveMs ?? null,
    expectedMessages: primarySummary?.expectedMessages ?? metrics.expectedMessages,
    receivedMessages: primarySummary?.receivedMessages ?? metrics.totalMessagesReceived,
    missingMessages: primarySummary?.missingMessages ?? metrics.missingMessages,
    sequenceGapMessages: primarySummary?.sequenceGapMessages ?? metrics.sequenceGapMessages,
    throughputPercent: primarySummary?.throughputPercent ?? metrics.throughputPercent,
    estimatedLatencyMs: {
      samples: primarySummary?.estimatedLatencySamples ?? metrics.estimatedEndToEndLatencyMs.samples,
      average: primarySummary?.estimatedLatencyAverageMs ?? metrics.estimatedEndToEndLatencyMs.average,
      min: primarySummary?.estimatedLatencyMinMs ?? metrics.estimatedEndToEndLatencyMs.min,
      max: primarySummary?.estimatedLatencyMaxMs ?? metrics.estimatedEndToEndLatencyMs.max,
      standardDeviation:
        primarySummary?.estimatedLatencyStdDevMs ??
        metrics.estimatedEndToEndLatencyMs.standardDeviation,
      p95: primarySummary?.estimatedLatencyP95Ms ?? metrics.estimatedEndToEndLatencyMs.p95
    },
    saturationIndicators: primarySummary?.saturationIndicators ?? [],
    saturationIndicatorCodes: primarySummary?.saturationIndicatorCodes ?? [],
    methodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    experiment: current,
    metrics,
    scientificSummary: summaries.length === 1 ? summaries[0] : summaries,
    invalidMessages: experiment.invalidMessages,
    interpretation: {
      processingTimeNote:
        SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${metrics.averageMessagesPerSecond} mensagens/s`,
      hadLostMessages: metrics.missingMessages > 0,
      hadInvalidMessages: metrics.totalInvalidMessages > 0,
      realTimeAdequacy:
        "WebSerial e direto e simples para um unico navegador, mas fica limitado ao suporte do navegador e ao computador conectado ao Arduino."
    }
  };
}
