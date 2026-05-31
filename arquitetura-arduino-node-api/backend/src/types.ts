export interface AccelerationPayload {
  x: number;
  y: number;
  z: number;
  magnitude: number;
}

export interface SensorPayload {
  id: number;
  sendUs: number;
  timestamp: number;
  heartRate: number;
  acceleration: AccelerationPayload;
}

export interface ProcessedSensorMessage {
  sensor: SensorPayload;
  receivedAt: string;
  backendReceiveMs: number;
  arduinoSendUs: number;
  estimatedBackendSendTimeMs: number | null;
  backendArduinoClockOffsetMs: number | null;
  backendArduinoClockUncertaintyMs: number | null;
  processingLatencyMs: number;
  // Marcado quando o backend detecta que o sendUs caiu abaixo do anterior
  // (rollover do micros() do Arduino a cada ~71,58 min). Latencia desta
  // amostra fica indefinida e nao deve ser usada nas estatisticas.
  rolloverSuspected?: boolean;
}

export type ExperimentArchitecture = "webserial" | "backend-node";
export type ExperimentSource = "serial" | "simulator";
export type ExperimentCommunicationMode = "webserial" | "rest-polling" | "websocket";
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

export interface NumericStats {
  samples: number;
  average: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
  p95?: number | null;
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

export interface ClockSyncMetadata {
  arduinoToBackendOffsetMs?: number | null;
  arduinoToBackendRttMs?: number | null;
  arduinoToBackendUncertaintyMs?: number | null;
  arduinoHostOffsetMs: number | null;
  arduinoHostRttMs: number | null;
  arduinoHostUncertaintyMs: number | null;
  arduinoRemoteUnit?: "us" | "ms" | null;
  backendToFrontendOffsetMs?: number | null;
  backendToFrontendRttMs?: number | null;
  backendToFrontendUncertaintyMs?: number | null;
  frontendBackendOffsetMs: number | null;
  frontendBackendRttMs: number | null;
  frontendBackendUncertaintyMs: number | null;
  arduinoToFrontendOffsetMs?: number | null;
  arduinoToFrontendUncertaintyMs?: number | null;
  syncAttempts: number;
  selectedBy: "lowest_rtt";
  syncedAt: string | null;
  syncFailed: boolean;
  fallbackReason?: string;
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

export interface SerialStatus {
  source: "serial" | "simulator";
  configuredPort: string | null;
  baudRate: number;
  connected: boolean;
  lastError: string | null;
}

export interface MetricsSnapshot {
  startedAt: string;
  elapsedSeconds: number;
  totalMessagesReceived: number;
  totalInvalidMessages: number;
  lostMessages: number;
  sequenceGapMessages: number;
  totalSamples: number;
  lastMessageAt: string | null;
  lastMessage: ProcessedSensorMessage | null;
  messagesPerSecond: number;
  averageMessagesPerSecond: number;
  lostMessagesPercent: number;
  invalidMessagesPercent: number;
  lastProcessingLatencyMs: number | null;
  processingLatencyMs: NumericStats;
  heartRate: NumericStats;
  accelerationMagnitude: NumericStats;
  serialConnected: boolean;
}
