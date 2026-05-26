import {
  ExperimentConfig,
  ExperimentState,
  MetricsSnapshot,
  ProcessedSensorMessage
} from "../types";
import { MetricsService } from "./metricsService";

interface InvalidExperimentMessage {
  receivedAt: string;
  rawLine: string;
}

interface ExperimentExport {
  sensorDataCsv: string;
  metricsCsv: string;
  summaryJson: string;
}

const DEFAULT_EXPERIMENT: ExperimentConfig = {
  architecture: "backend-node",
  source: "simulator",
  communicationMode: "websocket",
  sendIntervalMs: 100,
  durationSeconds: 60
};

export class ExperimentService {
  private currentExperiment: ExperimentState | null = null;
  private lastCompletedExperiment: ExperimentState | null = null;
  private readonly samples: ProcessedSensorMessage[] = [];
  private readonly invalidMessages: InvalidExperimentMessage[] = [];
  private lastMetricsSnapshot: MetricsSnapshot | null = null;
  private autoStopTimer: NodeJS.Timeout | null = null;

  constructor(private readonly metricsService: MetricsService) {}

  start(config: Partial<ExperimentConfig>): ExperimentState {
    this.clearAutoStopTimer();
    this.samples.length = 0;
    this.invalidMessages.length = 0;
    this.lastMetricsSnapshot = null;
    this.metricsService.reset();

    const experimentConfig = this.normalizeConfig(config);
    this.currentExperiment = {
      ...experimentConfig,
      id: this.createExperimentId(),
      status: "running",
      startedAt: new Date().toISOString(),
      stoppedAt: null
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
    this.metricsService.reset();
  }

  getCurrent(): ExperimentState | null {
    return this.currentExperiment ?? this.lastCompletedExperiment;
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

    return {
      sensorDataCsv: this.createSensorDataCsv(experiment),
      metricsCsv: this.createMetricsCsv(experiment),
      summaryJson: JSON.stringify(this.createSummary(experiment), null, 2)
    };
  }

  private normalizeConfig(config: Partial<ExperimentConfig>): ExperimentConfig {
    const sendIntervalMs = this.readPositiveInteger(
      config.sendIntervalMs,
      DEFAULT_EXPERIMENT.sendIntervalMs
    );
    const durationSeconds = this.readPositiveInteger(
      config.durationSeconds,
      DEFAULT_EXPERIMENT.durationSeconds
    );

    return {
      architecture: config.architecture === "webserial" ? "webserial" : "backend-node",
      source: config.source === "serial" ? "serial" : "simulator",
      communicationMode:
        config.communicationMode === "rest-polling" ? "rest-polling" : "websocket",
      sendIntervalMs,
      durationSeconds
    };
  }

  private readPositiveInteger(value: unknown, fallback: number): number {
    const numericValue = Number(value);

    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  }

  private createExperimentId(): string {
    return `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }

  private createSensorDataCsv(experiment: ExperimentState): string {
    const header = [
      "experiment_id",
      "architecture",
      "communication_mode",
      "source",
      "received_at",
      "seq",
      "send_ms",
      "hr",
      "ax",
      "ay",
      "az",
      "acceleration_magnitude",
      "local_processing_time_ms"
    ];
    const rows = this.samples.map((message) => [
      experiment.id,
      experiment.architecture,
      experiment.communicationMode,
      experiment.source,
      message.receivedAt,
      message.sensor.id,
      message.sensor.timestamp,
      message.sensor.heartRate,
      message.sensor.acceleration.x,
      message.sensor.acceleration.y,
      message.sensor.acceleration.z,
      message.sensor.acceleration.magnitude,
      message.processingLatencyMs
    ]);

    return this.toCsv([header, ...rows]);
  }

  private createMetricsCsv(experiment: ExperimentState): string {
    const metrics = this.lastMetricsSnapshot;
    const header = [
      "experiment_id",
      "architecture",
      "communication_mode",
      "source",
      "started_at",
      "stopped_at",
      "send_interval_ms",
      "duration_seconds",
      "total_messages_received",
      "total_invalid_messages",
      "lost_messages",
      "messages_per_second",
      "lost_messages_percent",
      "invalid_messages_percent",
      "local_processing_time_avg_ms",
      "local_processing_time_min_ms",
      "local_processing_time_max_ms",
      "local_processing_time_std_ms",
      "hr_avg",
      "acceleration_magnitude_avg"
    ];
    const row = [
      experiment.id,
      experiment.architecture,
      experiment.communicationMode,
      experiment.source,
      experiment.startedAt,
      experiment.stoppedAt ?? "",
      experiment.sendIntervalMs,
      experiment.durationSeconds,
      metrics?.totalMessagesReceived ?? this.samples.length,
      metrics?.totalInvalidMessages ?? this.invalidMessages.length,
      metrics?.lostMessages ?? 0,
      metrics?.averageMessagesPerSecond ?? 0,
      metrics?.lostMessagesPercent ?? 0,
      metrics?.invalidMessagesPercent ?? 0,
      metrics?.processingLatencyMs.average ?? "",
      metrics?.processingLatencyMs.min ?? "",
      metrics?.processingLatencyMs.max ?? "",
      metrics?.processingLatencyMs.standardDeviation ?? "",
      metrics?.heartRate.average ?? "",
      metrics?.accelerationMagnitude.average ?? ""
    ];

    return this.toCsv([header, row]);
  }

  private createSummary(experiment: ExperimentState): object {
    const metrics = this.lastMetricsSnapshot;

    return {
      experiment,
      metrics,
      invalidMessages: this.invalidMessages,
      interpretation: {
        processingTimeNote:
          "O tempo registrado e de processamento local na aplicacao, nao latencia fim a fim Arduino -> aplicacao. O campo send_ms usa millis()/temporizador local e nao esta sincronizado com o relogio do computador.",
        lowestLocalProcessingTime:
          metrics?.processingLatencyMs.min === null || metrics?.processingLatencyMs.min === undefined
            ? "Sem amostras validas."
            : `${metrics.processingLatencyMs.min} ms`,
        averageThroughput: `${metrics?.averageMessagesPerSecond ?? 0} mensagens/s`,
        hadLostMessages: (metrics?.lostMessages ?? 0) > 0,
        hadInvalidMessages: (metrics?.totalInvalidMessages ?? 0) > 0,
        realTimeAdequacy:
          experiment.communicationMode === "websocket"
            ? "WebSocket tende a ser mais adequado para tempo real por entregar eventos por push."
            : "REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes."
      }
    };
  }

  private toCsv(rows: Array<Array<string | number>>): string {
    return rows.map((row) => row.map((value) => this.escapeCsv(value)).join(",")).join("\n");
  }

  private escapeCsv(value: string | number): string {
    const text = String(value);

    if (!/[",\n]/.test(text)) {
      return text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  private clearAutoStopTimer(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }
}
