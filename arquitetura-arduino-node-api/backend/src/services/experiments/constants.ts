import { ExperimentConfig, ProcessedSensorMessage } from "../../types";

export interface InvalidExperimentMessage {
  receivedAt: string;
  rawLine: string;
}

export interface ExperimentExport {
  sensorDataCsv: string;
  metricsCsv: string;
  summaryJson: string;
}

// Estado interno do experimentService: usado pelos builders para acessar
// amostras coletadas e ultimo snapshot de metricas sem expor as colecoes
// mutaveis diretamente.
export interface ExperimentRuntimeState {
  samples: ProcessedSensorMessage[];
  invalidMessages: InvalidExperimentMessage[];
}

export const DEFAULT_EXPERIMENT: ExperimentConfig = {
  architecture: "backend-node",
  source: "simulator",
  communicationMode: "websocket",
  sendIntervalMs: 100,
  durationSeconds: 60,
  replicationNumber: 1
};

export const SCIENTIFIC_CONFIG = {
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
