import {
  ExperimentState,
  FrontendExperimentObservation,
  MetricsSnapshot
} from "../../types";
import { SCIENTIFIC_CONFIG } from "./constants";
import { environmentToCsv, percent, toCsv } from "./csv-utils";
import { addSaturationIndicators } from "./saturation";

interface CreateMetricsCsvInput {
  experiment: ExperimentState;
  metrics: MetricsSnapshot | null;
  observations: FrontendExperimentObservation[];
  observation?: FrontendExperimentObservation;
  invalidMessageCount: number;
  fallbackSamplesLength: number;
}

export function createMetricsCsv(input: CreateMetricsCsvInput): string {
  const { experiment, metrics, observations, observation, invalidMessageCount, fallbackSamplesLength } = input;
  const frontendSummary = observation?.summary;
  const expectedMessages = Math.floor(
    (experiment.durationSeconds * 1000) / experiment.sendIntervalMs
  );
  const receivedMessages = metrics?.totalMessagesReceived ?? fallbackSamplesLength;
  const missingMessages = Math.max(0, expectedMessages - receivedMessages);
  const sequenceGapMessages = metrics?.sequenceGapMessages ?? metrics?.lostMessages ?? 0;
  const header = [
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
    "local_processing_time_avg_ms",
    "local_processing_time_min_ms",
    "local_processing_time_max_ms",
    "local_processing_time_std_ms",
    "hr_avg",
    "acceleration_magnitude_avg"
  ];
  const rows = observations.length
    ? addSaturationIndicators(observations.map((item) => item.summary)).map((summary) => [
        summary.experimentId,
        summary.architecture,
        summary.communicationMode,
        summary.source,
        summary.startedAt,
        summary.stoppedAt ?? "",
        summary.intervalMs,
        summary.durationSeconds,
        summary.expectedMessages,
        summary.receivedMessages,
        summary.missingMessages,
        summary.sequenceGapMessages,
        summary.throughputPercent,
        summary.messagesPerSecond,
        summary.estimatedLatencyAverageMs ?? "",
        summary.estimatedLatencyMinMs ?? "",
        summary.estimatedLatencyMaxMs ?? "",
        summary.estimatedLatencyStdDevMs ?? "",
        summary.estimatedLatencyP95Ms ?? "",
        summary.uncertaintyAverageMs ?? "",
        summary.uncertaintyP95Ms ?? "",
        summary.uncertaintyMaxMs ?? "",
        summary.invalidMessages,
        summary.applicationVersion,
        summary.replicationNumber,
        summary.environment,
        summary.saturationIndicatorCodes.join(" | "),
        "",
        "",
        "",
        "",
        "",
        ""
      ])
    : [
        [
          experiment.id,
          experiment.architecture,
          experiment.communicationMode,
          experiment.source,
          experiment.startedAt,
          experiment.stoppedAt ?? "",
          experiment.sendIntervalMs,
          experiment.durationSeconds,
          expectedMessages,
          receivedMessages,
          missingMessages,
          sequenceGapMessages,
          percent(receivedMessages, expectedMessages),
          metrics?.averageMessagesPerSecond ?? 0,
          frontendSummary?.estimatedLatencyAverageMs ?? "",
          frontendSummary?.estimatedLatencyMinMs ?? "",
          frontendSummary?.estimatedLatencyMaxMs ?? "",
          frontendSummary?.estimatedLatencyStdDevMs ?? "",
          frontendSummary?.estimatedLatencyP95Ms ?? "",
          "",
          "",
          "",
          frontendSummary?.invalidMessages ?? metrics?.totalInvalidMessages ?? invalidMessageCount,
          frontendSummary?.applicationVersion ?? SCIENTIFIC_CONFIG.applicationVersion,
          frontendSummary?.replicationNumber ?? experiment.replicationNumber,
          frontendSummary?.environment ?? environmentToCsv(observation?.environment),
          frontendSummary?.saturationIndicatorCodes?.join(" | ") ?? "",
          metrics?.processingLatencyMs.average ?? "",
          metrics?.processingLatencyMs.min ?? "",
          metrics?.processingLatencyMs.max ?? "",
          metrics?.processingLatencyMs.standardDeviation ?? "",
          metrics?.heartRate.average ?? "",
          metrics?.accelerationMagnitude.average ?? ""
        ]
      ];

  return toCsv([header, ...rows]);
}
