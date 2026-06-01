import {
  ClockSyncMetadata,
  ExperimentState,
  FrontendExperimentObservation,
  MetricsSnapshot
} from "../../types";
import { InvalidExperimentMessage, SCIENTIFIC_CONFIG } from "./constants";
import { percent } from "./csv-utils";
import {
  addSaturationIndicators,
  createFallbackSummary,
  createSaturationAnalysis
} from "./saturation";

interface CreateSummaryInput {
  experiment: ExperimentState;
  metrics: MetricsSnapshot | null;
  observations: FrontendExperimentObservation[];
  observation?: FrontendExperimentObservation;
  invalidMessages: InvalidExperimentMessage[];
  fallbackSamplesLength: number;
  currentClockSync: ClockSyncMetadata | null;
}

export function createSummary(input: CreateSummaryInput): object {
  const {
    experiment,
    metrics,
    observations,
    observation,
    invalidMessages,
    fallbackSamplesLength,
    currentClockSync
  } = input;
  const frontendSummary = observation?.summary;
  const expectedMessages = Math.floor(
    (experiment.durationSeconds * 1000) / experiment.sendIntervalMs
  );
  const receivedMessages = metrics?.totalMessagesReceived ?? fallbackSamplesLength;
  const missingMessages = Math.max(0, expectedMessages - receivedMessages);
  const sequenceGapMessages = metrics?.sequenceGapMessages ?? metrics?.lostMessages ?? 0;
  const fallbackSummary = createFallbackSummary(
    experiment,
    expectedMessages,
    receivedMessages,
    missingMessages,
    sequenceGapMessages,
    metrics?.totalInvalidMessages ?? invalidMessages.length,
    metrics?.averageMessagesPerSecond ?? 0,
    currentClockSync
  );
  const runSummaries = observations.length
    ? addSaturationIndicators(observations.map((item) => item.summary))
    : [frontendSummary ?? fallbackSummary];
  const runSummary = runSummaries[runSummaries.length - 1] ?? fallbackSummary;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(runSummaries);
  const campaignId = observation?.campaignId ?? null;

  return {
    campaign: campaignId
      ? {
          id: campaignId,
          architecture: runSummary.architecture,
          communicationMode: runSummary.communicationMode,
          source: runSummary.source,
          startedAt: runSummaries[0]?.startedAt ?? experiment.startedAt,
          stoppedAt: runSummaries[runSummaries.length - 1]?.stoppedAt ?? experiment.stoppedAt,
          intervalsMs: runSummaries.map((summary) => summary.intervalMs),
          replicationNumber: runSummary.replicationNumber
        }
      : null,
    runs: runSummaries,
    saturationAnalysis,
    saturation,
    experiment,
    expectedMessages,
    receivedMessages,
    missingMessages,
    sequenceGapMessages,
    throughputPercent: percent(receivedMessages, expectedMessages),
    replicationNumber: runSummary.replicationNumber,
    environment: observation?.environment ?? null,
    applicationVersion: runSummary.applicationVersion,
    latencyType: runSummary.latencyType,
    latencyMethod: runSummary.latencyMethod,
    latencyLimitation: runSummary.latencyLimitation,
    latencyEstimationMethod: runSummary.latencyEstimationMethod,
    latencyMethodologyNote: runSummary.latencyMethodologyNote,
    clockSync: runSummary.clockSync ?? currentClockSync,
    estimatedLatencyMs: {
      samples: runSummary.estimatedLatencySamples,
      average: runSummary.estimatedLatencyAverageMs,
      min: runSummary.estimatedLatencyMinMs,
      max: runSummary.estimatedLatencyMaxMs,
      standardDeviation: runSummary.estimatedLatencyStdDevMs,
      p95: runSummary.estimatedLatencyP95Ms
    },
    metrics: metrics
      ? {
          ...metrics,
          missingMessages,
          sequenceGapMessages,
          throughputPercent: percent(receivedMessages, expectedMessages)
        }
      : null,
    invalidMessages,
    interpretation: {
      processingTimeNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      lowestLocalProcessingTime:
        metrics?.processingLatencyMs.min === null || metrics?.processingLatencyMs.min === undefined
          ? "Sem amostras validas."
          : `${metrics.processingLatencyMs.min} ms`,
      averageThroughput: `${metrics?.averageMessagesPerSecond ?? 0} mensagens/s`,
      hadLostMessages: missingMessages > 0,
      hadInvalidMessages: (metrics?.totalInvalidMessages ?? 0) > 0,
      realTimeAdequacy:
        experiment.communicationMode === "websocket"
          ? "WebSocket tende a ser mais adequado para tempo real por entregar eventos por push."
          : "REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes."
    }
  };
}
