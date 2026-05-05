import { performance } from "node:perf_hooks";
import { MetricsService } from "./metricsService";
import { ProcessedSensorMessage, SensorPayload } from "../types";

type MessageListener = (message: ProcessedSensorMessage) => void;

export class SensorDataService {
  private latestMessage: ProcessedSensorMessage | null = null;
  private readonly listeners = new Set<MessageListener>();

  constructor(private readonly metricsService: MetricsService) {}

  onMessage(listener: MessageListener): void {
    this.listeners.add(listener);
  }

  getLatestMessage(): ProcessedSensorMessage | null {
    return this.latestMessage;
  }

  processSerialLine(line: string): void {
    const startedAt = performance.now();
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      return;
    }

    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(trimmedLine);
    } catch {
      this.metricsService.recordInvalidMessage();
      console.warn(`[serial] JSON invalido recebido: ${trimmedLine}`);
      return;
    }

    const sensorPayload = this.validateSensorPayload(parsedPayload);

    if (!sensorPayload) {
      this.metricsService.recordInvalidMessage();
      console.warn(`[serial] Payload fora do formato esperado: ${trimmedLine}`);
      return;
    }

    const processingLatencyMs = Number((performance.now() - startedAt).toFixed(3));
    const message: ProcessedSensorMessage = {
      sensor: sensorPayload,
      receivedAt: new Date().toISOString(),
      processingLatencyMs
    };

    this.latestMessage = message;
    this.metricsService.recordValidMessage(message);
    this.notifyListeners(message);
  }

  private notifyListeners(message: ProcessedSensorMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  private validateSensorPayload(payload: unknown): SensorPayload | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const candidate = payload as Record<string, unknown>;
    const id = candidate.id;
    const timestamp = candidate.timestamp;
    const heartRate = candidate.heartRate;
    const acceleration = candidate.acceleration;
    const temperature = candidate.temperature;

    const hasRequiredNumbers =
      this.isPositiveInteger(id) &&
      this.isNonNegativeNumber(timestamp) &&
      this.isNumberInRange(heartRate, 70, 220) &&
      this.isNonNegativeNumber(acceleration);

    if (!hasRequiredNumbers) {
      return null;
    }

    if (temperature !== undefined && !this.isNumberInRange(temperature, 0, 60)) {
      return null;
    }

    return {
      id,
      timestamp,
      heartRate,
      acceleration,
      ...(temperature !== undefined ? { temperature } : {})
    };
  }

  private isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }

  private isNonNegativeNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
  }

  private isNumberInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  }
}
