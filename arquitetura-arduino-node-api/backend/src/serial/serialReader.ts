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

interface PendingSync {
  syncId: number;
  t0: number;
  resolve: (reply: SyncReply) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface SyncReply {
  syncId: number;
  arduinoT1Us?: number;
  arduinoT2Us?: number;
  arduinoMillis?: number;
  legacy: boolean;
  receivedAtMs: number;
}

const SYNC_TIMEOUT_MS = 2000;
const SYNC_INTER_ATTEMPT_MS = 50;
const SYNC_SAFE_INTERVAL_MS = 100;
const SYNC_DRAIN_MS = 250;
const SYNC_ID_LIMIT = 1_000_000_000;

export class SerialReader {
  private serialPort: SerialPort | null = null;
  private connected = false;
  private lastError: string | null = null;
  private readonly pendingSyncReplies = new Map<number, PendingSync>();
  private nextSyncId = 1;

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
      this.rejectAllPending(new Error("serial port closed"));
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

  /**
   * Sincroniza o relogio com o Arduino em estado *idle* (intervalo seguro = 100 ms),
   * para evitar contencao do TX serial em altas frequencias. Apos o SYNC, o chamador
   * deve aplicar o intervalo experimental real.
   */
  async synchronizeClock(
    attempts = 10,
    targetIntervalMs?: number
  ): Promise<ClockSyncMetadata> {
    if (!this.serialPort?.writable) {
      return this.createSyncFailure("serial_port_not_writable", 0);
    }

    // 1) Forca Arduino para 100 ms (idle) antes do SYNC, para a serial nao
    //    estar saturada por amostras pendentes.
    this.setIntervalMs(SYNC_SAFE_INTERVAL_MS);
    await this.sleep(SYNC_DRAIN_MS);

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
      } catch (error) {
        console.warn(`[serial] Tentativa SYNC falhou: ${(error as Error).message}`);
      }
      await this.sleep(SYNC_INTER_ATTEMPT_MS);
    }

    // 2) Aplica o intervalo experimental requisitado depois do SYNC.
    if (
      typeof targetIntervalMs === "number" &&
      Number.isFinite(targetIntervalMs) &&
      targetIntervalMs > 0 &&
      targetIntervalMs !== SYNC_SAFE_INTERVAL_MS
    ) {
      this.setIntervalMs(targetIntervalMs);
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

    if (fields.length === 0) {
      return;
    }

    const replySyncId = Number(fields[0]);
    if (!Number.isFinite(replySyncId)) {
      return;
    }

    const pending = this.pendingSyncReplies.get(replySyncId);
    if (!pending) {
      // Resposta atrasada de uma tentativa que ja expirou (ou sync legacy
      // com payload de 1 campo, que so e suportado quando o Arduino e quem
      // dispara o SYNC sem id) — descarta para nao corromper outra atribuicao.
      return;
    }

    clearTimeout(pending.timer);
    this.pendingSyncReplies.delete(replySyncId);

    if (fields.length >= 3) {
      const arduinoT1Us = Number(fields[1]);
      const arduinoT2Us = Number(fields[2]);

      if (Number.isFinite(arduinoT1Us) && Number.isFinite(arduinoT2Us)) {
        pending.resolve({
          syncId: replySyncId,
          arduinoT1Us,
          arduinoT2Us,
          legacy: false,
          receivedAtMs: performance.now()
        });
        return;
      }

      pending.reject(
        new Error(`SYNC_REPLY com campos invalidos: ${JSON.stringify(fields)}`)
      );
      return;
    }

    pending.resolve({
      syncId: replySyncId,
      arduinoMillis: replySyncId,
      legacy: true,
      receivedAtMs: performance.now()
    });
  }

  private async runSyncAttempt(): Promise<{
    offsetMs: number;
    rttMs: number;
    uncertaintyMs: number;
    remoteUnit: "us" | "ms";
  } | null> {
    const syncId = this.nextSyncId++;
    if (this.nextSyncId > SYNC_ID_LIMIT) {
      // protege Arduino String.toInt() (long signed 32-bit) de overflow.
      this.nextSyncId = 1;
    }

    const t0 = performance.now();
    const reply = await this.requestSync(syncId, t0);
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

  private requestSync(syncId: number, t0: number): Promise<SyncReply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const stillPending = this.pendingSyncReplies.get(syncId);
        if (stillPending) {
          this.pendingSyncReplies.delete(syncId);
          reject(new Error("timeout aguardando SYNC_REPLY"));
        }
      }, SYNC_TIMEOUT_MS);

      this.pendingSyncReplies.set(syncId, { syncId, t0, resolve, reject, timer });

      try {
        this.serialPort?.write(`SYNC,${syncId}\n`, (writeErr) => {
          if (writeErr) {
            clearTimeout(timer);
            this.pendingSyncReplies.delete(syncId);
            reject(writeErr);
          }
        });
      } catch (writeError) {
        clearTimeout(timer);
        this.pendingSyncReplies.delete(syncId);
        reject(writeError as Error);
      }
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pendingSyncReplies.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingSyncReplies.clear();
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
