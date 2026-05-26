import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { SerialStatus } from "../types";

interface SerialReaderOptions {
  portPath: string | null;
  baudRate: number;
  onLine: (line: string) => void;
}

export class SerialReader {
  private serialPort: SerialPort | null = null;
  private connected = false;
  private lastError: string | null = null;

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
    parser.on("data", this.options.onLine);

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
}
