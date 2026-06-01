import {
  ClockSyncMetadata,
  ExperimentConfig,
  ExperimentState,
  FrontendExperimentObservation,
  MetricsSnapshot,
  ProcessedSensorMessage
} from "../types";
import { MetricsService } from "./metricsService";
import {
  ExperimentExport,
  InvalidExperimentMessage
} from "./experiments/constants";
import { createExperimentId, normalizeConfig } from "./experiments/config";
import { selectExportObservations } from "./experiments/saturation";
import { createSensorDataCsv } from "./experiments/sensor-data-csv";
import { createMetricsCsv } from "./experiments/metrics-csv";
import { createSummary } from "./experiments/summary-builder";

export class ExperimentService {
  private currentExperiment: ExperimentState | null = null;
  private lastCompletedExperiment: ExperimentState | null = null;
  private readonly samples: ProcessedSensorMessage[] = [];
  private readonly invalidMessages: InvalidExperimentMessage[] = [];
  private readonly frontendObservations = new Map<string, FrontendExperimentObservation>();
  private lastMetricsSnapshot: MetricsSnapshot | null = null;
  private currentClockSync: ClockSyncMetadata | null = null;
  private autoStopTimer: NodeJS.Timeout | null = null;

  constructor(private readonly metricsService: MetricsService) {}

  start(config: Partial<ExperimentConfig>, clockSync: ClockSyncMetadata | null = null): ExperimentState {
    this.clearAutoStopTimer();
    this.samples.length = 0;
    this.invalidMessages.length = 0;
    this.frontendObservations.clear();
    this.lastMetricsSnapshot = null;
    this.currentClockSync = clockSync;
    this.metricsService.reset();

    const experimentConfig = normalizeConfig(config);
    this.currentExperiment = {
      ...experimentConfig,
      id: createExperimentId(),
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      clockSync
    };

    this.autoStopTimer = setTimeout(() => {
      this.stop(false);
    }, experimentConfig.durationSeconds * 1000);

    return this.currentExperiment;
  }

  stop(serialConnected: boolean): ExperimentState | null {
    this.clearAutoStopTimer();

    if (!this.currentExperiment) {
      return this.lastCompletedExperiment;
    }

    if (this.currentExperiment.status === "running") {
      this.lastMetricsSnapshot = this.metricsService.getSnapshot(serialConnected);
    }

    this.currentExperiment = {
      ...this.currentExperiment,
      status: "stopped",
      stoppedAt: new Date().toISOString()
    };
    this.lastCompletedExperiment = this.currentExperiment;

    return this.currentExperiment;
  }

  reset(): void {
    this.clearAutoStopTimer();
    this.currentExperiment = null;
    this.lastCompletedExperiment = null;
    this.samples.length = 0;
    this.invalidMessages.length = 0;
    this.lastMetricsSnapshot = null;
    this.currentClockSync = null;
    this.metricsService.reset();
  }

  recordFrontendObservation(observation: FrontendExperimentObservation): void {
    if (!observation?.experimentId || !observation.summary) {
      return;
    }

    this.frontendObservations.set(observation.experimentId, observation);
  }

  getCurrent(): ExperimentState | null {
    return this.currentExperiment ?? this.lastCompletedExperiment;
  }

  getCurrentClockSync(): ClockSyncMetadata | null {
    return this.currentClockSync;
  }

  isRunning(): boolean {
    return this.currentExperiment?.status === "running";
  }

  recordValidMessage(message: ProcessedSensorMessage): void {
    if (!this.isRunning()) {
      return;
    }

    this.samples.push(message);
  }

  recordInvalidMessage(rawLine: string): void {
    if (!this.isRunning()) {
      return;
    }

    this.invalidMessages.push({
      receivedAt: new Date().toISOString(),
      rawLine
    });
  }

  updateMetricsSnapshot(snapshot: MetricsSnapshot): void {
    if (this.currentExperiment?.status === "stopped") {
      return;
    }

    this.lastMetricsSnapshot = snapshot;
  }

  export(): ExperimentExport | null {
    const experiment = this.getCurrent();

    if (!experiment) {
      return null;
    }

    const observations = selectExportObservations(experiment.id, this.frontendObservations);
    const observation =
      observations[observations.length - 1] ?? this.frontendObservations.get(experiment.id);

    return {
      sensorDataCsv: createSensorDataCsv(experiment, observations, this.samples),
      metricsCsv: createMetricsCsv({
        experiment,
        metrics: this.lastMetricsSnapshot,
        observations,
        observation,
        invalidMessageCount: this.invalidMessages.length,
        fallbackSamplesLength: this.samples.length
      }),
      summaryJson: JSON.stringify(
        createSummary({
          experiment,
          metrics: this.lastMetricsSnapshot,
          observations,
          observation,
          invalidMessages: this.invalidMessages,
          fallbackSamplesLength: this.samples.length,
          currentClockSync: this.currentClockSync
        }),
        null,
        2
      )
    };
  }

  private clearAutoStopTimer(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }
}
