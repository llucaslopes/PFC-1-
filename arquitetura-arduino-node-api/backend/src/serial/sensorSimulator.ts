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
      this.options.onLine(this.createCsvLine());
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

  private createCsvLine(): string {
    const elapsedMs = Date.now() - this.startedAtMs;
    const t = elapsedMs / 1000;
    const heartRate = Math.round(70 + 15 * Math.sin(t * 1.2));
    const ax = 0.02 * Math.sin(t * 3.0) + this.randomBetween(-0.005, 0.005);
    const ay = 0.02 * Math.cos(t * 4.0) + this.randomBetween(-0.005, 0.005);
    const az = 1.0 + 0.1 * Math.sin(t * 2.0) + this.randomBetween(-0.01, 0.01);
    const line = [
      this.nextMessageId,
      elapsedMs,
      heartRate,
      ax.toFixed(4),
      ay.toFixed(4),
      az.toFixed(4)
    ].join(",");

    this.nextMessageId++;
    return line;
  }

  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}
