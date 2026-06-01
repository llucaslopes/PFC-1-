import {
  ExperimentState,
  FrontendExperimentObservation,
  ProcessedSensorMessage
} from "../../types";
import { round, roundNullable, toCsv } from "./csv-utils";

export function createSensorDataCsv(
  experiment: ExperimentState,
  observations: FrontendExperimentObservation[],
  fallbackSamples: ProcessedSensorMessage[]
): string {
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
  const rows = observations.length
    ? observations.flatMap((observation) =>
        observation.samples.map((sample) => [
          observation.summary.experimentId,
          observation.summary.architecture,
          observation.summary.communicationMode,
          observation.summary.source,
          observation.summary.intervalMs,
          sample.seq,
          sample.sendUs ?? (sample.sendMs != null ? Math.round(sample.sendMs * 1000) : ""),
          round(sample.frontendReceiveMs ?? sample.receiveMs),
          roundNullable(sample.estimatedFrontendSendMs),
          roundNullable(sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs),
          roundNullable(sample.clockOffsetMs ?? sample.clockSyncOffsetMs),
          roundNullable(sample.clockUncertaintyMs ?? sample.clockSyncUncertaintyMs),
          roundNullable(sample.syncRttMs),
          sample.latencyMethod ?? "",
          sample.hr,
          sample.ax,
          sample.ay,
          sample.az
        ])
      )
    : fallbackSamples.map((message) => [
        experiment.id,
        experiment.architecture,
        experiment.communicationMode,
        experiment.source,
        experiment.sendIntervalMs,
        message.sensor.id,
        message.arduinoSendUs,
        "",
        roundNullable(message.estimatedBackendSendTimeMs),
        "",
        roundNullable(message.backendArduinoClockOffsetMs),
        roundNullable(message.backendArduinoClockUncertaintyMs),
        "",
        "",
        message.sensor.heartRate,
        message.sensor.acceleration.x,
        message.sensor.acceleration.y,
        message.sensor.acceleration.z
      ]);

  return toCsv([header, ...rows]);
}
