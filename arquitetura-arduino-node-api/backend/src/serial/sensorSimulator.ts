import { SerialStatus } from "../types";

interface SensorSimulatorOptions {
  intervalMs: number;
  onLine: (line: string) => void;
}

export class SensorSimulator {
  private timer: NodeJS.Timeout | null = null;
  private startedAtMs = 0;
  private nextMessageId = 1;

  constructor(private readonly options: SensorSimulatorOptions) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.startedAtMs = Date.now();
    this.timer = setInterval(() => {
      this.options.onLine(JSON.stringify(this.createPayload()));
    }, this.options.intervalMs);

    console.log(`[simulator] Gerando dados a cada ${this.options.intervalMs} ms.`);
  }

  getStatus(): SerialStatus {
    return {
      source: "simulator",
      configuredPort: null,
      baudRate: 0,
      connected: this.timer !== null,
      lastError: null
    };
  }

  private createPayload(): Record<string, number> {
    const elapsedMs = Date.now() - this.startedAtMs;
    const activityWave = Math.sin(this.nextMessageId / 5);
    const effort = Math.max(0, activityWave);

    const payload = {
      id: this.nextMessageId,
      timestamp: elapsedMs,
      heartRate: Math.round(82 + effort * 54 + this.randomBetween(-5, 5)),
      acceleration: Number((0.65 + effort * 1.85 + this.randomBetween(0, 0.35)).toFixed(2)),
      temperature: Number((36.2 + effort * 1.1 + this.randomBetween(-0.2, 0.2)).toFixed(1))
    };

    this.nextMessageId++;
    return payload;
  }

  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}
