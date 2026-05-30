import {
  ExperimentConfig,
  ExperimentState,
  FrontendExperimentObservation,
  ClockSyncMetadata,
  MetricsSnapshot,
  ProcessedSensorMessage,
  ScientificRunSummary
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
  durationSeconds: 60,
  replicationNumber: 1
};

const SCIENTIFIC_CONFIG = {
  applicationVersion: "0.1.0",
  throughputSaturationPercent: 95,
  latencyGrowthFactor: 2,
  latencyType: "clock_synchronized_estimated_end_to_end",
  latencyMethod: "ntp_style_clock_offset_estimation",
  latencyLimitation:
    "Software clock synchronization estimates offset and uncertainty; it is not a perfect physical measurement.",
  latencyEstimationMethod: "ntp_style_clock_offset_estimation",
  latencyMethodologyNote:
    "A latencia fim a fim e estimada por sincronizacao de relogio estilo NTP quando disponivel, com offset e incerteza registrados. Sem sincronizacao, o sistema usa fallback relativo explicitamente marcado."
};

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

    const experimentConfig = this.normalizeConfig(config);
    this.currentExperiment = {
      ...experimentConfig,
      id: this.createExperimentId(),
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
    const replicationNumber = this.readPositiveInteger(
      config.replicationNumber,
      DEFAULT_EXPERIMENT.replicationNumber
    );

    return {
      architecture: config.architecture === "webserial" ? "webserial" : "backend-node",
      source: config.source === "serial" ? "serial" : "simulator",
      communicationMode:
        config.communicationMode === "rest-polling" ? "rest-polling" : "websocket",
      sendIntervalMs,
      durationSeconds,
      replicationNumber
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

  private getExportObservations(experiment: ExperimentState): FrontendExperimentObservation[] {
    const currentObservation = this.frontendObservations.get(experiment.id);

    if (!currentObservation) {
      return [];
    }

    if (!currentObservation.campaignId) {
      return [currentObservation];
    }

    return [...this.frontendObservations.values()]
      .filter((observation) => observation.campaignId === currentObservation.campaignId)
      .sort((a, b) => a.summary.intervalMs - b.summary.intervalMs);
  }

  private createSensorDataCsv(experiment: ExperimentState): string {
    const observations = this.getExportObservations(experiment);
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
            this.round(sample.frontendReceiveMs ?? sample.receiveMs),
            this.roundNullable(sample.estimatedFrontendSendMs),
            this.roundNullable(sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs),
            this.roundNullable(sample.clockOffsetMs ?? sample.clockSyncOffsetMs),
            this.roundNullable(sample.clockUncertaintyMs ?? sample.clockSyncUncertaintyMs),
            this.roundNullable(sample.syncRttMs),
            sample.latencyMethod ?? "",
            sample.hr,
            sample.ax,
            sample.ay,
            sample.az
          ])
        )
      : this.samples.map((message) => [
          experiment.id,
          experiment.architecture,
          experiment.communicationMode,
          experiment.source,
          experiment.sendIntervalMs,
          message.sensor.id,
          message.arduinoSendUs,
          "",
          this.roundNullable(message.estimatedBackendSendTimeMs),
          "",
          this.roundNullable(message.backendArduinoClockOffsetMs),
          this.roundNullable(message.backendArduinoClockUncertaintyMs),
          "",
          "",
          message.sensor.heartRate,
          message.sensor.acceleration.x,
          message.sensor.acceleration.y,
          message.sensor.acceleration.z
        ]);

    return this.toCsv([header, ...rows]);
  }

  private createMetricsCsv(experiment: ExperimentState): string {
    const metrics = this.lastMetricsSnapshot;
    const observations = this.getExportObservations(experiment);
    const observation = observations[observations.length - 1] ?? this.frontendObservations.get(experiment.id);
    const frontendSummary = observation?.summary;
    const expectedMessages = Math.floor(
      (experiment.durationSeconds * 1000) / experiment.sendIntervalMs
    );
    const receivedMessages = metrics?.totalMessagesReceived ?? this.samples.length;
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
      ? this.addSaturationIndicators(observations.map((item) => item.summary)).map((summary) => [
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
            this.percent(receivedMessages, expectedMessages),
            metrics?.averageMessagesPerSecond ?? 0,
            frontendSummary?.estimatedLatencyAverageMs ?? "",
            frontendSummary?.estimatedLatencyMinMs ?? "",
            frontendSummary?.estimatedLatencyMaxMs ?? "",
            frontendSummary?.estimatedLatencyStdDevMs ?? "",
            frontendSummary?.estimatedLatencyP95Ms ?? "",
            frontendSummary?.invalidMessages ?? metrics?.totalInvalidMessages ?? this.invalidMessages.length,
            frontendSummary?.applicationVersion ?? SCIENTIFIC_CONFIG.applicationVersion,
            frontendSummary?.replicationNumber ?? experiment.replicationNumber,
            frontendSummary?.environment ?? this.environmentToCsv(observation?.environment),
            frontendSummary?.saturationIndicatorCodes?.join(" | ") ?? "",
            metrics?.processingLatencyMs.average ?? "",
            metrics?.processingLatencyMs.min ?? "",
            metrics?.processingLatencyMs.max ?? "",
            metrics?.processingLatencyMs.standardDeviation ?? "",
            metrics?.heartRate.average ?? "",
            metrics?.accelerationMagnitude.average ?? ""
          ]
        ];

    return this.toCsv([header, ...rows]);
  }

  private createSummary(experiment: ExperimentState): object {
    const metrics = this.lastMetricsSnapshot;
    const observations = this.getExportObservations(experiment);
    const observation = observations[observations.length - 1] ?? this.frontendObservations.get(experiment.id);
    const frontendSummary = observation?.summary;
    const expectedMessages = Math.floor(
      (experiment.durationSeconds * 1000) / experiment.sendIntervalMs
    );
    const receivedMessages = metrics?.totalMessagesReceived ?? this.samples.length;
    const missingMessages = Math.max(0, expectedMessages - receivedMessages);
    const sequenceGapMessages = metrics?.sequenceGapMessages ?? metrics?.lostMessages ?? 0;
    const fallbackSummary = this.createFallbackSummary(
      experiment,
      expectedMessages,
      receivedMessages,
      missingMessages,
      sequenceGapMessages,
      metrics?.totalInvalidMessages ?? this.invalidMessages.length,
      metrics?.averageMessagesPerSecond ?? 0
    );
    const runSummaries = observations.length
      ? this.addSaturationIndicators(observations.map((item) => item.summary))
      : [frontendSummary ?? fallbackSummary];
    const runSummary = runSummaries[runSummaries.length - 1] ?? fallbackSummary;
    const { saturationAnalysis, saturation } = this.createSaturationAnalysis(runSummaries);
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
      throughputPercent: this.percent(receivedMessages, expectedMessages),
      replicationNumber: runSummary.replicationNumber,
      environment: observation?.environment ?? null,
      applicationVersion: runSummary.applicationVersion,
      latencyType: runSummary.latencyType,
      latencyMethod: runSummary.latencyMethod,
      latencyLimitation: runSummary.latencyLimitation,
      latencyEstimationMethod: runSummary.latencyEstimationMethod,
      latencyMethodologyNote: runSummary.latencyMethodologyNote,
      clockSync: runSummary.clockSync ?? this.currentClockSync,
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
            throughputPercent: this.percent(receivedMessages, expectedMessages)
          }
        : null,
      invalidMessages: this.invalidMessages,
      interpretation: {
        processingTimeNote:
          SCIENTIFIC_CONFIG.latencyMethodologyNote,
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

  private createFallbackSummary(
    experiment: ExperimentState,
    expectedMessages: number,
    receivedMessages: number,
    missingMessages: number,
    sequenceGapMessages: number,
    invalidMessages: number,
    messagesPerSecond: number
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
      latencyType: this.currentClockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
      latencyMethod: this.currentClockSync?.syncFailed
        ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
        : SCIENTIFIC_CONFIG.latencyMethod,
      latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
      latencyEstimationMethod: this.currentClockSync?.syncFailed
        ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
        : SCIENTIFIC_CONFIG.latencyEstimationMethod,
      latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      latencyBaselineSendMs: null,
      latencyBaselineReceiveMs: null,
      clockSync: this.currentClockSync,
      expectedMessages,
      receivedMessages,
      missingMessages,
      sequenceGapMessages,
      lostMessages: missingMessages,
      invalidMessages,
      messagesPerSecond,
      throughputPercent: this.percent(receivedMessages, expectedMessages),
      missingMessagesPercent: this.percent(missingMessages, expectedMessages),
      lostPercent: this.percent(missingMessages, expectedMessages),
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

  private createSaturationAnalysis(summaries: ScientificRunSummary[]): {
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
  } {
    const annotated = this.addSaturationIndicators(summaries);
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

  private addSaturationIndicators(summaries: ScientificRunSummary[]): ScientificRunSummary[] {
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

  private toCsv(rows: Array<Array<string | number | null>>): string {
    return rows.map((row) => row.map((value) => this.escapeCsv(value)).join(",")).join("\n");
  }

  private escapeCsv(value: string | number | null): string {
    const text = value === null ? "" : String(value);

    if (!/[",\n]/.test(text)) {
      return text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  private percent(part: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Number(((part / total) * 100).toFixed(3));
  }

  private round(value: number, digits = 3): number {
    return Number(value.toFixed(digits));
  }

  private roundNullable(value: number | null, digits = 3): string | number {
    return Number.isFinite(value) ? this.round(value as number, digits) : "";
  }

  private environmentToCsv(environment: Record<string, unknown> | undefined): string {
    if (!environment) {
      return "";
    }

    return Object.entries(environment)
      .map(([key, value]) => `${key}=${String(value).replace(/;/g, ",")}`)
      .join("; ");
  }

  private clearAutoStopTimer(): void {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
  }
}
