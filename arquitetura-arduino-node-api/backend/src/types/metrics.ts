import { ProcessedSensorMessage } from "./sensor";

// Tipos de estatisticas numericas e snapshot de metricas agregadas
// servido por GET /metrics.

export interface NumericStats {
  samples: number;
  average: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
  p95?: number | null;
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
