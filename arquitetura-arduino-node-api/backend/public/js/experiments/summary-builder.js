
/**
 * Monta o objeto JSON exportado em `_experiment-summary.json`.
 * Extraido de `experiments.js` (Sub-fase 3.3) — schema preservado bit-a-bit.
 */

import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  createExperimentExportBlock,
  createRunSummary,
  createSaturationAnalysis
} from "../scientific.js";
import { state } from "../state.js";

import {
  createObservedMetrics,
  getLatencyMethod,
  getLatencyType
} from "./metrics-builder.js";

export function createSummary(experiment, { collectExperimentEnvironment, readReplicationNumber }) {
  const metrics = createObservedMetrics(experiment);
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
  const primarySummary = summaries[0];
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(summaries);
  const campaign = state.campaign
    ? {
        ...state.campaign,
        stoppedAt: state.campaign.stoppedAt,
        applicationVersion: SCIENTIFIC_CONFIG.applicationVersion
      }
    : null;

  return {
    ...exportBlock,
    campaign,
    runs: summaries,
    saturationAnalysis,
    saturation,
    architecture: experiment.architecture,
    communicationMode: experiment.communicationMode,
    source: experiment.source,
    intervalMs: experiment.sendIntervalMs,
    durationSeconds: experiment.durationSeconds,
    startedAt: experiment.startedAt,
    stoppedAt: experiment.stoppedAt,
    replicationNumber: experiment.replicationNumber ?? readReplicationNumber(),
    environment: experiment.environment ?? collectExperimentEnvironment(experiment),
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: getLatencyType(experiment.clockSync),
    latencyMethod: getLatencyMethod(experiment.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: getLatencyMethod(experiment.clockSync),
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: experiment.clockSync ?? state.clockSync,
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
    experiment,
    metrics,
    scientificSummary: summaries.length === 1 ? summaries[0] : summaries,
    interpretation: {
      processingTimeNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${metrics.averageMessagesPerSecond} mensagens/s`,
      realTimeAdequacy:
        experiment.communicationMode === "websocket"
          ? "WebSocket tende a ser mais adequado para tempo real por entregar eventos por push."
          : "REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes."
    }
  };
}
