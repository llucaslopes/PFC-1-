import { ReadlineParser } from "@serialport/parser-readline";
import { performance } from "node:perf_hooks";
import { SerialPort } from "serialport";
import { ClockSyncMetadata, SerialStatus } from "../types";
import { computeCristianSync } from "../utils/clockSyncMath";

interface SerialReaderOptions {
  portPath: string | null;
  baudRate: number;
  onLine: (line: string) => void;
}

interface SyncReply {
  clientT0?: number;
  arduinoT1Us?: number;
  arduinoT2Us?: number;
  arduinoMillis?: number;
  legacy: boolean;
  receivedAtMs: number;
}

export class SerialReader {
  private serialPort: SerialPort | null = null;
  private connected = false;
  private lastError: string | null = null;
  private readonly pendingSyncReplies: Array<(reply: SyncReply) => void> = [];

  constructor(private readonly options: SerialReaderOptions) {}

  start(): void {
    if (!this.options.portPath) {
      this.lastError = "SERIAL_PORT nao foi configurada. O backend iniciou sem leitura serial.";
      console.warn(`[serial] ${this.lastError}`);
      return;
    }

    this.serialPort = new SerialPort({
      path: this.options.portPath,
      baudRate: this.options.baudRate,
      autoOpen: false
    });

    const parser = this.serialPort.pipe(new ReadlineParser({ delimiter: "\n" }));
    parser.on("data", (line: string) => this.handleLine(line));

    this.serialPort.on("open", () => {
      this.connected = true;
      this.lastError = null;
      console.log(`[serial] Conectado em ${this.options.portPath} a ${this.options.baudRate} bps.`);
    });

    this.serialPort.on("error", (error) => {
      this.connected = false;
      this.lastError = error.message;
      console.error(`[serial] Erro na porta serial: ${error.message}`);
    });

    this.serialPort.on("close", () => {
      this.connected = false;
      console.warn("[serial] Porta serial fechada.");
    });

    this.serialPort.open((error) => {
      if (!error) {
        return;
      }

      this.connected = false;
      this.lastError = error.message;
      console.error(`[serial] Nao foi possivel abrir ${this.options.portPath}: ${error.message}`);
    });
  }

  getStatus(): SerialStatus {
    return {
      source: "serial",
      configuredPort: this.options.portPath,
      baudRate: this.options.baudRate,
      connected: this.connected,
      lastError: this.lastError
    };
  }

  setIntervalMs(intervalMs: number): void {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0 || !this.serialPort?.writable) {
      return;
    }

    this.serialPort.write(`INTERVAL_MS=${intervalMs}\n`, (error) => {
      if (error) {
        this.lastError = error.message;
        console.error(`[serial] Falha ao enviar intervalo ao Arduino: ${error.message}`);
        return;
      }

      console.log(`[serial] Intervalo solicitado ao Arduino: ${intervalMs} ms.`);
    });
  }

  async synchronizeClock(attempts = 10): Promise<ClockSyncMetadata> {
    if (!this.serialPort?.writable) {
      return this.createSyncFailure("serial_port_not_writable", 0);
    }

    const samples: Array<{
      offsetMs: number;
      rttMs: number;
      uncertaintyMs: number;
      remoteUnit: "us" | "ms";
    }> = [];

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const sample = await this.runSyncAttempt();
        if (sample) {
          samples.push(sample);
        }
        await this.sleep(20);
      } catch (error) {
        console.warn(`[serial] Tentativa SYNC falhou: ${(error as Error).message}`);
      }
    }

    if (!samples.length) {
      return this.createSyncFailure("no_valid_sync_reply", attempts);
    }

    const selected = samples.sort((a, b) => a.rttMs - b.rttMs)[0];
    const offsetMs = Number(selected.offsetMs.toFixed(3));

    return {
      arduinoToBackendOffsetMs: offsetMs,
      arduinoToBackendRttMs: Number(selected.rttMs.toFixed(3)),
      arduinoToBackendUncertaintyMs: Number(selected.uncertaintyMs.toFixed(3)),
      arduinoHostOffsetMs: offsetMs,
      arduinoHostRttMs: Number(selected.rttMs.toFixed(3)),
      arduinoHostUncertaintyMs: Number(selected.uncertaintyMs.toFixed(3)),
      arduinoRemoteUnit: selected.remoteUnit,
      frontendBackendOffsetMs: null,
      frontendBackendRttMs: null,
      frontendBackendUncertaintyMs: null,
      syncAttempts: attempts,
      selectedBy: "lowest_rtt",
      syncedAt: new Date().toISOString(),
      syncFailed: false
    };
  }

  private handleLine(line: string): void {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("SYNC_REPLY,")) {
      this.consumeSyncReply(trimmedLine);
      return;
    }

    this.options.onLine(line);
  }

  private consumeSyncReply(line: string): void {
    const payload = line.slice("SYNC_REPLY,".length);
    const fields = payload.split(",").map((field) => field.trim());
    const resolve = this.pendingSyncReplies.shift();

    if (!resolve) {
      return;
    }

    if (fields.length >= 3) {
      const arduinoT1Us = Number(fields[1]);
      const arduinoT2Us = Number(fields[2]);

      if (Number.isFinite(arduinoT1Us) && Number.isFinite(arduinoT2Us)) {
        resolve({
          clientT0: Number(fields[0]),
          arduinoT1Us,
          arduinoT2Us,
          legacy: false,
          receivedAtMs: performance.now()
        });
      }

      return;
    }

    const arduinoMillis = Number(fields[0]);
    if (Number.isFinite(arduinoMillis) && arduinoMillis >= 0) {
      resolve({ arduinoMillis, legacy: true, receivedAtMs: performance.now() });
    }
  }

  private async runSyncAttempt(): Promise<{
    offsetMs: number;
    rttMs: number;
    uncertaintyMs: number;
    remoteUnit: "us" | "ms";
  } | null> {
    const t0 = performance.now();
    const clientT0 = Math.round(t0 * 1000);
    const replyPromise = this.waitForSyncReply();
    this.serialPort?.write(`SYNC,${clientT0}\n`);
    const reply = await this.withTimeout(replyPromise, 500);
    const t3 = reply.receivedAtMs;

    if (reply.legacy && reply.arduinoMillis !== undefined) {
      const rttMs = t3 - t0;
      return {
        offsetMs: (t0 + t3) / 2 - reply.arduinoMillis,
        rttMs,
        uncertaintyMs: rttMs / 2,
        remoteUnit: "ms"
      };
    }

    if (reply.arduinoT1Us === undefined || reply.arduinoT2Us === undefined) {
      return null;
    }

    const result = computeCristianSync({
      t0,
      t1: reply.arduinoT1Us,
      t2: reply.arduinoT2Us,
      t3,
      remoteUnit: "us"
    });

    return {
      offsetMs: result.offsetMs,
      rttMs: result.roundTripMs,
      uncertaintyMs: result.uncertaintyMs,
      remoteUnit: "us"
    };
  }

  private waitForSyncReply(): Promise<SyncReply> {
    return new Promise((resolve) => {
      this.pendingSyncReplies.push(resolve);
    });
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSyncReplies.shift();
        reject(new Error("timeout aguardando SYNC_REPLY"));
      }, timeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private createSyncFailure(reason: string, attempts: number): ClockSyncMetadata {
    return {
      arduinoToBackendOffsetMs: null,
      arduinoToBackendRttMs: null,
      arduinoToBackendUncertaintyMs: null,
      arduinoHostOffsetMs: null,
      arduinoHostRttMs: null,
      arduinoHostUncertaintyMs: null,
      arduinoRemoteUnit: null,
      frontendBackendOffsetMs: null,
      frontendBackendRttMs: null,
      frontendBackendUncertaintyMs: null,
      syncAttempts: attempts,
      selectedBy: "lowest_rtt",
      syncedAt: null,
      syncFailed: true,
      fallbackReason: reason
    };
  }
}
