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
    this.startTimer();

    console.log(`[simulator] Gerando dados a cada ${this.options.intervalMs} ms.`);
  }

  setIntervalMs(intervalMs: number): void {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      return;
    }

    this.options.intervalMs = intervalMs;

    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.startTimer();
    console.log(`[simulator] Intervalo atualizado para ${this.options.intervalMs} ms.`);
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
    const sendUs = elapsedMs * 1000;
    const t = elapsedMs / 1000;
    const heartRate = Math.round(70 + 15 * Math.sin(t * 1.2));
    const ax = 0.02 * Math.sin(t * 3.0) + this.randomBetween(-0.005, 0.005);
    const ay = 0.02 * Math.cos(t * 4.0) + this.randomBetween(-0.005, 0.005);
    const az = 1.0 + 0.1 * Math.sin(t * 2.0) + this.randomBetween(-0.01, 0.01);
    const line = [
      this.nextMessageId,
      sendUs,
      heartRate,
      ax.toFixed(4),
      ay.toFixed(4),
      az.toFixed(4)
    ].join(",");

    this.nextMessageId++;
    return line;
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      this.options.onLine(this.createCsvLine());
    }, this.options.intervalMs);
  }

  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}
