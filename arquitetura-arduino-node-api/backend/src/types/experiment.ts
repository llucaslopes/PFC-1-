import { ClockSyncMetadata } from "./clock";

// Tipos de configuracao, estado e amostras de experimentos cientificos.
// Incluem o contrato de observacao reportado pelo frontend ao backend
// (FrontendExperimentObservation) e o sumario final (ScientificRunSummary).

export type ExperimentArchitecture =
  | "backend-node"
  | "serverless"
  | "mqtt"
  // Mantidos como strings historicas para preservar leitura de campanhas
  // anteriores; nao sao mais escolhas validas para novas campanhas.
  | "webserial";
export type ExperimentSource = "wifi-http" | "serial" | "simulator";
export type ExperimentCommunicationMode =
  | "websocket"
  | "rest-polling"
  | "serverless-http"
  | "mqtt"
  | "webserial";
export type ExperimentStatus = "idle" | "running" | "stopped";

export interface ExperimentConfig {
  architecture: ExperimentArchitecture;
  source: ExperimentSource;
  communicationMode: ExperimentCommunicationMode;
  sendIntervalMs: number;
  durationSeconds: number;
  replicationNumber: number;
}

export interface ExperimentState extends ExperimentConfig {
  id: string;
  status: ExperimentStatus;
  startedAt: string;
  stoppedAt: string | null;
  clockSync?: ClockSyncMetadata | null;
}

export interface FrontendObservedSample {
  receivedAt: string;
  frontendReceiveMs: number;
  receiveMs: number;
  seq: number;
  sendUs: number;
  sendMs: number;
  hr: number;
  ax: number;
  ay: number;
  az: number;
  accelerationMagnitude: number;
  estimatedFrontendSendMs: number | null;
  endToEndLatencyMs: number | null;
  estimatedEndToEndLatencyMs: number | null;
  relativeEstimatedLatencyMs: number | null;
  clockOffsetMs: number | null;
  clockSyncOffsetMs: number | null;
  clockUncertaintyMs: number | null;
  clockSyncUncertaintyMs: number | null;
  syncRttMs: number | null;
  latencyMethod: string;
  localProcessingLatencyMs: number;
}

export interface LatencyMetadata {
  latencyType: string;
  latencyMethod: string;
  latencyLimitation: string;
  latencyEstimationMethod: string;
  latencyMethodologyNote: string;
  latencyBaselineSendMs: number | null;
  latencyBaselineReceiveMs: number | null;
  clockSync?: ClockSyncMetadata | null;
}

export interface ScientificRunSummary extends LatencyMetadata {
  experimentId: string;
  architecture: ExperimentArchitecture;
  communicationMode: ExperimentCommunicationMode;
  source: ExperimentSource;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  intervalMs: number;
  applicationVersion: string;
  replicationNumber: number;
  environment: string;
  expectedMessages: number;
  receivedMessages: number;
  missingMessages: number;
  sequenceGapMessages: number;
  lostMessages: number;
  invalidMessages: number;
  messagesPerSecond: number;
  throughputPercent: number;
  missingMessagesPercent: number;
  lostPercent: number;
  estimatedLatencySamples: number;
  estimatedLatencyAverageMs: number | null;
  estimatedLatencyMinMs: number | null;
  estimatedLatencyMaxMs: number | null;
  estimatedLatencyStdDevMs: number | null;
  estimatedLatencyP95Ms: number | null;
  uncertaintyAverageMs?: number | null;
  uncertaintyP95Ms?: number | null;
  uncertaintyMaxMs?: number | null;
  saturationIndicators: string[];
  saturationIndicatorCodes: string[];
}

export interface SaturationAnalysis {
  firstThroughputBelow95IntervalMs: number | null;
  firstLossDetectedIntervalMs: number | null;
  firstLatencyDegradationIntervalMs: number | null;
}

export interface FrontendExperimentObservation {
  experimentId: string;
  campaignId?: string | null;
  replicationNumber: number;
  environment: Record<string, unknown>;
  samples: FrontendObservedSample[];
  invalidMessages: Array<Record<string, unknown>>;
  summary: ScientificRunSummary;
}
