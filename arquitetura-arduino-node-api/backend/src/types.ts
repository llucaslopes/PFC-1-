export interface SensorPayload {
  id: number;
  timestamp: number;
  heartRate: number;
  acceleration: number;
  temperature?: number;
}

export interface ProcessedSensorMessage {
  sensor: SensorPayload;
  receivedAt: string;
  processingLatencyMs: number;
}

export interface SerialStatus {
  source: "serial" | "simulator";
  configuredPort: string | null;
  baudRate: number;
  connected: boolean;
  lastError: string | null;
}

export interface MetricsSnapshot {
  totalMessagesReceived: number;
  totalInvalidMessages: number;
  lostMessages: number;
  lastMessageAt: string | null;
  lastMessage: ProcessedSensorMessage | null;
  messagesPerSecond: number;
  lastProcessingLatencyMs: number | null;
  serialConnected: boolean;
}
