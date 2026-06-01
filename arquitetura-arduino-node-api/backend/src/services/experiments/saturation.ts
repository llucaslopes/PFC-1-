import {
  ClockSyncMetadata,
  ExperimentState,
  ScientificRunSummary
} from "../../types";
import { SCIENTIFIC_CONFIG } from "./constants";
import { percent } from "./csv-utils";

export function addSaturationIndicators(
  summaries: ScientificRunSummary[]
): ScientificRunSummary[] {
  const baseline = summaries.find((summary) => summary.intervalMs === 100) ?? summaries[0] ?? null;

  for (const summary of summaries) {
    const codes: string[] = [...(summary.saturationIndicatorCodes ?? [])];
    const labels: string[] = [...(summary.saturationIndicators ?? [])];

    if (
      summary.throughputPercent < SCIENTIFIC_CONFIG.throughputSaturationPercent &&
      !codes.includes("throughput_below_95")
    ) {
      codes.push("throughput_below_95");
      labels.push(
        `A partir de ${summary.intervalMs} ms o throughput caiu abaixo de ${SCIENTIFIC_CONFIG.throughputSaturationPercent}%.`
      );
    }

    if (summary.missingMessages > 0 && !codes.includes("message_loss_detected")) {
      codes.push("message_loss_detected");
      labels.push(`A partir de ${summary.intervalMs} ms foram detectadas perdas de mensagens.`);
    }

    if (baseline?.estimatedLatencyAverageMs && summary.estimatedLatencyAverageMs) {
      const limit = baseline.estimatedLatencyAverageMs * SCIENTIFIC_CONFIG.latencyGrowthFactor;
      if (summary.estimatedLatencyAverageMs > limit && !codes.includes("latency_average_doubled")) {
        codes.push("latency_average_doubled");
        labels.push(
          `A partir de ${summary.intervalMs} ms a latencia estimada media dobrou em relacao ao baseline de ${baseline.intervalMs} ms.`
        );
      }
    }

    if (baseline?.estimatedLatencyP95Ms && summary.estimatedLatencyP95Ms) {
      const limit = baseline.estimatedLatencyP95Ms * SCIENTIFIC_CONFIG.latencyGrowthFactor;
      if (summary.estimatedLatencyP95Ms > limit && !codes.includes("latency_p95_doubled")) {
        codes.push("latency_p95_doubled");
        labels.push(
          `A partir de ${summary.intervalMs} ms o p95 de latencia estimada dobrou em relacao ao baseline de ${baseline.intervalMs} ms.`
        );
      }
    }

    summary.saturationIndicatorCodes = codes;
    summary.saturationIndicators = labels;
  }

  return summaries;
}

export interface SaturationAnalysisResult {
  saturationAnalysis: {
    firstThroughputBelow95IntervalMs: number | null;
    firstLossDetectedIntervalMs: number | null;
    firstLatencyDegradationIntervalMs: number | null;
  };
  saturation: {
    throughputThresholdPercent: number;
    latencyGrowthFactor: number;
    firstCompromisedIntervalMs: number | null;
    reason: string | null;
    indicators: string[];
  };
}

export function createSaturationAnalysis(
  summaries: ScientificRunSummary[]
): SaturationAnalysisResult {
  const annotated = addSaturationIndicators(summaries);
  const byInterval = [...annotated].sort((a, b) => b.intervalMs - a.intervalMs);
  const firstThroughputBelow95 = byInterval.find(
    (summary) => summary.throughputPercent < SCIENTIFIC_CONFIG.throughputSaturationPercent
  );
  const firstLossDetected = byInterval.find((summary) => summary.missingMessages > 0);
  const firstLatencyAverageDoubled = byInterval.find((summary) =>
    summary.saturationIndicatorCodes.includes("latency_average_doubled")
  );
  const firstLatencyP95Doubled = byInterval.find((summary) =>
    summary.saturationIndicatorCodes.includes("latency_p95_doubled")
  );
  const compromised = byInterval.find((summary) => summary.saturationIndicatorCodes.length);

  return {
    saturationAnalysis: {
      firstThroughputBelow95IntervalMs: firstThroughputBelow95?.intervalMs ?? null,
      firstLossDetectedIntervalMs: firstLossDetected?.intervalMs ?? null,
      firstLatencyDegradationIntervalMs:
        firstLatencyAverageDoubled?.intervalMs ?? firstLatencyP95Doubled?.intervalMs ?? null
    },
    saturation: {
      throughputThresholdPercent: SCIENTIFIC_CONFIG.throughputSaturationPercent,
      latencyGrowthFactor: SCIENTIFIC_CONFIG.latencyGrowthFactor,
      firstCompromisedIntervalMs: compromised?.intervalMs ?? null,
      reason: compromised?.saturationIndicatorCodes[0] ?? null,
      indicators: [...new Set(annotated.flatMap((summary) => summary.saturationIndicatorCodes))]
    }
  };
}

export function createFallbackSummary(
  experiment: ExperimentState,
  expectedMessages: number,
  receivedMessages: number,
  missingMessages: number,
  sequenceGapMessages: number,
  invalidMessages: number,
  messagesPerSecond: number,
  currentClockSync: ClockSyncMetadata | null
): ScientificRunSummary {
  return {
    experimentId: experiment.id,
    architecture: experiment.architecture,
    communicationMode: experiment.communicationMode,
    source: experiment.source,
    startedAt: experiment.startedAt,
    stoppedAt: experiment.stoppedAt,
    durationSeconds: experiment.durationSeconds,
    intervalMs: experiment.sendIntervalMs,
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    replicationNumber: experiment.replicationNumber,
    environment: "",
    latencyType: currentClockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: currentClockSync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : SCIENTIFIC_CONFIG.latencyMethod,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: currentClockSync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : SCIENTIFIC_CONFIG.latencyEstimationMethod,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    latencyBaselineSendMs: null,
    latencyBaselineReceiveMs: null,
    clockSync: currentClockSync,
    expectedMessages,
    receivedMessages,
    missingMessages,
    sequenceGapMessages,
    lostMessages: missingMessages,
    invalidMessages,
    messagesPerSecond,
    throughputPercent: percent(receivedMessages, expectedMessages),
    missingMessagesPercent: percent(missingMessages, expectedMessages),
    lostPercent: percent(missingMessages, expectedMessages),
    estimatedLatencySamples: 0,
    estimatedLatencyAverageMs: null,
    estimatedLatencyMinMs: null,
    estimatedLatencyMaxMs: null,
    estimatedLatencyStdDevMs: null,
    estimatedLatencyP95Ms: null,
    saturationIndicators: [],
    saturationIndicatorCodes: []
  };
}

// Auxiliar: filtra observacoes de uma campanha (mesma campaignId) ordenadas
// por intervalo crescente, OU retorna apenas a observacao avulsa do
// experimento se nao houver campanha.
export function selectExportObservations<T extends { campaignId?: string | null; summary: { intervalMs: number } }>(
  experimentId: string,
  observations: Map<string, T>
): T[] {
  const currentObservation = observations.get(experimentId);

  if (!currentObservation) {
    return [];
  }

  if (!currentObservation.campaignId) {
    return [currentObservation];
  }

  return [...observations.values()]
    .filter((observation) => observation.campaignId === currentObservation.campaignId)
    .sort((a, b) => a.summary.intervalMs - b.summary.intervalMs);
}
