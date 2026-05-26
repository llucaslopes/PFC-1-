import { MetricsSnapshot, ProcessedSensorMessage } from "../types";
import { calculateNumericStats, percent } from "./statistics";

export class MetricsService {
  private startedAtMs = Date.now();
  private totalMessagesReceived = 0;
  private totalInvalidMessages = 0;
  private lostMessages = 0;
  private lastMessageId: number | null = null;
  private lastMessage: ProcessedSensorMessage | null = null;
  private lastProcessingLatencyMs: number | null = null;
  private readonly processingLatenciesMs: number[] = [];
  private readonly heartRates: number[] = [];
  private readonly accelerationMagnitudes: number[] = [];

  recordValidMessage(message: ProcessedSensorMessage): void {
    const currentId = message.sensor.id;

    if (this.lastMessageId !== null && currentId > this.lastMessageId + 1) {
      this.lostMessages += currentId - this.lastMessageId - 1;
    }

    this.lastMessageId = currentId;
    this.lastMessage = message;
    this.lastProcessingLatencyMs = message.processingLatencyMs;
    this.totalMessagesReceived++;
    this.processingLatenciesMs.push(message.processingLatencyMs);
    this.heartRates.push(message.sensor.heartRate);
    this.accelerationMagnitudes.push(message.sensor.acceleration.magnitude);
  }

  recordInvalidMessage(): void {
    this.totalInvalidMessages++;
  }

  reset(): void {
    this.startedAtMs = Date.now();
    this.totalMessagesReceived = 0;
    this.totalInvalidMessages = 0;
    this.lostMessages = 0;
    this.lastMessageId = null;
    this.lastMessage = null;
    this.lastProcessingLatencyMs = null;
    this.processingLatenciesMs.length = 0;
    this.heartRates.length = 0;
    this.accelerationMagnitudes.length = 0;
  }

  getSnapshot(serialConnected: boolean): MetricsSnapshot {
    const elapsedSeconds = Math.max((Date.now() - this.startedAtMs) / 1000, 1);
    const expectedMessages =
      this.totalMessagesReceived + this.totalInvalidMessages + this.lostMessages;

    return {
      startedAt: new Date(this.startedAtMs).toISOString(),
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      totalMessagesReceived: this.totalMessagesReceived,
      totalInvalidMessages: this.totalInvalidMessages,
      lostMessages: this.lostMessages,
      totalSamples: this.totalMessagesReceived,
      lastMessageAt: this.lastMessage?.receivedAt ?? null,
      lastMessage: this.lastMessage,
      messagesPerSecond: Number((this.totalMessagesReceived / elapsedSeconds).toFixed(3)),
      averageMessagesPerSecond: Number((this.totalMessagesReceived / elapsedSeconds).toFixed(3)),
      lostMessagesPercent: percent(this.lostMessages, expectedMessages),
      invalidMessagesPercent: percent(this.totalInvalidMessages, expectedMessages),
      lastProcessingLatencyMs: this.lastProcessingLatencyMs,
      processingLatencyMs: calculateNumericStats(this.processingLatenciesMs),
      heartRate: calculateNumericStats(this.heartRates),
      accelerationMagnitude: calculateNumericStats(this.accelerationMagnitudes),
      serialConnected
    };
  }
}
