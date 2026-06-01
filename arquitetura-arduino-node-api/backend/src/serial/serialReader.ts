import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { ClockSyncMetadata, SerialStatus } from "../types";
import { ClockSyncCoordinator } from "./clock-sync/sync-coordinator";

interface SerialReaderOptions {
  portPath: string | null;
  baudRate: number;
  onLine: (line: string) => void;
}

export class SerialReader {
  private serialPort: SerialPort | null = null;
  private connected = false;
  private lastError: string | null = null;
  private readonly clockSync: ClockSyncCoordinator;

  constructor(private readonly options: SerialReaderOptions) {
    this.clockSync = new ClockSyncCoordinator({
      writeLine: (line) => this.writeLine(line),
      setIntervalMs: (intervalMs) => this.setIntervalMs(intervalMs),
      isWritable: () => Boolean(this.serialPort?.writable)
    });
  }

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
      this.clockSync.rejectAllPending(new Error("serial port closed"));
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
  synchronizeClock(
    attempts = 10,
    targetIntervalMs?: number
  ): Promise<ClockSyncMetadata> {
    return this.clockSync.synchronizeClock(attempts, targetIntervalMs);
  }

  private handleLine(line: string): void {
    if (this.clockSync.consumeLineIfSyncReply(line)) {
      return;
    }

    this.options.onLine(line);
  }

  private writeLine(line: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.serialPort?.write(line, (writeErr) => {
          if (writeErr) {
            reject(writeErr);
            return;
          }
          resolve();
        });
      } catch (writeError) {
        reject(writeError as Error);
      }
    });
  }
}
