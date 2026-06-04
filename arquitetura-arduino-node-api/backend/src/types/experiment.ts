import { ClockSyncMetadata } from "./clock";

// Modelos compartilhados entre routes, services e o cliente que
// orquestra a campanha. As enumeracoes precisam casar 1:1 com as
// listas em scripts/lib_mjs/cli-args.mjs e em scripts/plot_results.py
// (por nao haver fonte de tipos comum entre Node e Python).
//
// Os valores "webserial" e "serial" continuam aqui mesmo sem entrarem
// na campanha oficial atual: removelos quebraria a leitura de
// experiment-summary.json arquivados de campanhas pre-Wi-Fi e os testes
// que validam essa leitura.

export type ExperimentArchitecture =
  | "backend-node"
  | "serverless"
  | "mqtt"
  | "webserial";

export type ExperimentSource =
  | "wifi-http"
  | "simulator-http"
  | "simulator"
  | "serial";

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
