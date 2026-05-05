import { MetricsSnapshot, ProcessedSensorMessage } from "../types";

export class MetricsService {
  private readonly startedAtMs = Date.now();
  private totalMessagesReceived = 0;
  private totalInvalidMessages = 0;
  private lostMessages = 0;
  private lastMessageId: number | null = null;
  private lastMessage: ProcessedSensorMessage | null = null;
  private lastProcessingLatencyMs: number | null = null;

  recordValidMessage(message: ProcessedSensorMessage): void {
    const currentId = message.sensor.id;

    if (this.lastMessageId !== null && currentId > this.lastMessageId + 1) {
      this.lostMessages += currentId - this.lastMessageId - 1;
    }

    this.lastMessageId = currentId;
    this.lastMessage = message;
    this.lastProcessingLatencyMs = message.processingLatencyMs;
    this.totalMessagesReceived++;
  }

  recordInvalidMessage(): void {
    this.totalInvalidMessages++;
  }

  getSnapshot(serialConnected: boolean): MetricsSnapshot {
    const elapsedSeconds = Math.max((Date.now() - this.startedAtMs) / 1000, 1);

    return {
      totalMessagesReceived: this.totalMessagesReceived,
      totalInvalidMessages: this.totalInvalidMessages,
      lostMessages: this.lostMessages,
      lastMessageAt: this.lastMessage?.receivedAt ?? null,
      lastMessage: this.lastMessage,
      messagesPerSecond: Number((this.totalMessagesReceived / elapsedSeconds).toFixed(3)),
      lastProcessingLatencyMs: this.lastProcessingLatencyMs,
      serialConnected
    };
  }
}
