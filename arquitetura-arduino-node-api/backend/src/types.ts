export interface AccelerationPayload {
  x: number;
  y: number;
  z: number;
  magnitude: number;
}

export interface SensorPayload {
  id: number;
  timestamp: number;
  heartRate: number;
  acceleration: AccelerationPayload;
}

export interface ProcessedSensorMessage {
  sensor: SensorPayload;
  receivedAt: string;
  processingLatencyMs: number;
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
}

export interface ExperimentState extends ExperimentConfig {
  id: string;
  status: ExperimentStatus;
  startedAt: string;
  stoppedAt: string | null;
}

export interface NumericStats {
  samples: number;
  average: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
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
