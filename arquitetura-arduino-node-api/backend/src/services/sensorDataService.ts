import { performance } from "node:perf_hooks";
import { MetricsService } from "./metricsService";
import { ProcessedSensorMessage, SensorPayload } from "../types";

type MessageListener = (message: ProcessedSensorMessage) => void;

const CSV_FIELD_COUNT = 6;

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

    const sensorPayload = this.parseCsvPayload(trimmedLine);

    if (!sensorPayload) {
      this.metricsService.recordInvalidMessage();
      console.warn(`[serial] Linha CSV fora do formato esperado: ${trimmedLine}`);
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

  private parseCsvPayload(line: string): SensorPayload | null {
    const fields = line.split(",").map((field) => field.trim());

    if (fields.length !== CSV_FIELD_COUNT) {
      return null;
    }

    const [seqRaw, sendMsRaw, heartRateRaw, axRaw, ayRaw, azRaw] = fields;
    const id = Number(seqRaw);
    const timestamp = Number(sendMsRaw);
    const heartRate = Number(heartRateRaw);
    const x = Number(axRaw);
    const y = Number(ayRaw);
    const z = Number(azRaw);

    const hasRequiredNumbers =
      this.isPositiveInteger(id) &&
      this.isNonNegativeNumber(timestamp) &&
      this.isNumberInRange(heartRate, 40, 220) &&
      this.isNumberInRange(x, -16, 16) &&
      this.isNumberInRange(y, -16, 16) &&
      this.isNumberInRange(z, -16, 16);

    if (!hasRequiredNumbers) {
      return null;
    }

    const magnitude = Number(Math.sqrt(x ** 2 + y ** 2 + z ** 2).toFixed(4));

    return {
      id,
      timestamp,
      heartRate,
      acceleration: {
        x,
        y,
        z,
        magnitude
      }
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
