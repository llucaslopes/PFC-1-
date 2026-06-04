import { performance } from "node:perf_hooks";
import { ExperimentService } from "./experimentService";
import { MetricsService } from "./metricsService";
import { ClockSyncMetadata, ProcessedSensorMessage, SensorPayload } from "../types";
import { detectSendUnit, remoteSendToHostMs } from "../utils/clockSyncMath";

type MessageListener = (message: ProcessedSensorMessage) => void;
type RolloverListener = (event: RolloverEvent) => void;

export interface RolloverEvent {
  seq: number;
  previousSendUs: number;
  currentSendUs: number;
  deltaUs: number;
  detectedAtMs: number;
}

const CSV_FIELD_COUNT = 6;

export class SensorDataService {
  private latestMessage: ProcessedSensorMessage | null = null;
  private readonly listeners = new Set<MessageListener>();
  private readonly rolloverListeners = new Set<RolloverListener>();
  // Monotonicidade do micros() do Arduino: se cair, e rollover (~71,58 min).
  // Resetado a cada novo experimento via `resetRolloverTracking()`.
  private lastSendUs: number | null = null;
  private lastSeq: number | null = null;
  private rolloverDetectedCount = 0;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly experimentService?: ExperimentService,
    private readonly clockSyncProvider?: () => ClockSyncMetadata | null
  ) {}

  onRolloverDetected(listener: RolloverListener): void {
    this.rolloverListeners.add(listener);
  }

  resetRolloverTracking(): void {
    this.lastSendUs = null;
    this.lastSeq = null;
    this.rolloverDetectedCount = 0;
  }

  getRolloverDetectedCount(): number {
    return this.rolloverDetectedCount;
  }

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
      this.experimentService?.recordInvalidMessage(trimmedLine);
      console.warn(`[serial] Linha CSV fora do formato esperado: ${trimmedLine}`);
      return;
    }

    this.processParsedPayload(sensorPayload, startedAt);
  }

  // Ingestao via HTTP (ESP32 + Wi-Fi). Recebe um objeto JSON ja parseado
  // (a validacao de tipos basica fica na rota /ingest/sensor; aqui apenas
  // garantimos as faixas semanticas).
  processJsonPayload(rawPayload: Record<string, unknown>): {
    accepted: boolean;
    reason?: string;
  } {
    const startedAt = performance.now();
    const sensorPayload = this.normalizeJsonPayload(rawPayload);

    if (!sensorPayload) {
      const rawText = JSON.stringify(rawPayload);
      this.metricsService.recordInvalidMessage();
      this.experimentService?.recordInvalidMessage(rawText);
      return { accepted: false, reason: "invalid_payload" };
    }

    this.processParsedPayload(sensorPayload, startedAt);
    return { accepted: true };
  }

  private processParsedPayload(sensorPayload: SensorPayload, startedAt: number): void {
    const backendReceiveMs = performance.now();
    const clockSync = this.clockSyncProvider?.() ?? null;
    const arduinoOffset =
      clockSync?.arduinoToBackendOffsetMs ?? clockSync?.arduinoHostOffsetMs ?? null;
    const backendArduinoClockOffsetMs =
      clockSync && !clockSync.syncFailed && Number.isFinite(arduinoOffset) ? arduinoOffset : null;
    const sendUnit = detectSendUnit(sensorPayload.sendUs, clockSync?.arduinoRemoteUnit);

    // Deteccao de rollover do micros() do Arduino. Como o sketch envia seq
    // monotonico crescente, se o sendUs cair para um valor MENOR que o
    // anterior estando seq > lastSeq, e quase certo que micros() deu volta.
    // Marcamos a amostra como rolloverSuspected e nao computamos latencia
    // a partir dela; throughput/perdas/recursos seguem normalmente.
    const sendUsRollover =
      this.lastSendUs !== null &&
      this.lastSeq !== null &&
      sensorPayload.id > this.lastSeq &&
      sensorPayload.sendUs < this.lastSendUs;

    if (sendUsRollover) {
      this.rolloverDetectedCount += 1;
      const event: RolloverEvent = {
        seq: sensorPayload.id,
        previousSendUs: this.lastSendUs as number,
        currentSendUs: sensorPayload.sendUs,
        deltaUs: sensorPayload.sendUs - (this.lastSendUs as number),
        detectedAtMs: backendReceiveMs
      };
      console.warn(
        `[serial] Rollover do micros() detectado: seq=${event.seq} ` +
          `prev=${event.previousSendUs} cur=${event.currentSendUs} (delta=${event.deltaUs}us). ` +
          `Latencia desta amostra ignorada. Recomendado: ressincronizar relogio.`
      );
      for (const listener of this.rolloverListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error(`[serial] Listener de rollover falhou: ${(error as Error).message}`);
        }
      }
    }

    this.lastSendUs = sensorPayload.sendUs;
    this.lastSeq = sensorPayload.id;

    const estimatedBackendSendTimeMs =
      backendArduinoClockOffsetMs === null || sendUsRollover
        ? null
        : remoteSendToHostMs(sensorPayload.sendUs, sendUnit, backendArduinoClockOffsetMs);
    const processingLatencyMs = Number((performance.now() - startedAt).toFixed(3));
    const message: ProcessedSensorMessage = {
      sensor: sensorPayload,
      receivedAt: new Date().toISOString(),
      backendReceiveMs: Number(backendReceiveMs.toFixed(3)),
      arduinoSendUs: sensorPayload.sendUs,
      estimatedBackendSendTimeMs:
        estimatedBackendSendTimeMs === null ? null : Number(estimatedBackendSendTimeMs.toFixed(3)),
      backendArduinoClockOffsetMs,
      backendArduinoClockUncertaintyMs:
        clockSync?.arduinoToBackendUncertaintyMs ??
        clockSync?.arduinoHostUncertaintyMs ??
        null,
      processingLatencyMs,
      rolloverSuspected: sendUsRollover,
      deviceId: sensorPayload.deviceId,
      wifiRssiDbm: sensorPayload.wifiRssiDbm ?? null,
      wifiReconnects: sensorPayload.wifiReconnects ?? null
    };

    this.latestMessage = message;
    this.metricsService.recordValidMessage(message);
    this.experimentService?.recordValidMessage(message);
    this.notifyListeners(message);
  }

  // Aceita o payload JSON do ESP32:
  //   { deviceId, seq, send_us, hr, ax, ay, az, wifi_rssi_dbm?, wifi_reconnects? }
  // Aplica as mesmas validacoes de faixa do parseCsvPayload.
  private normalizeJsonPayload(raw: Record<string, unknown>): SensorPayload | null {
    if (!raw || typeof raw !== "object") {
      return null;
    }

    const id = Number((raw as { seq?: unknown }).seq);
    const sendUs = Number((raw as { send_us?: unknown }).send_us ?? (raw as { sendUs?: unknown }).sendUs);
    const heartRate = Number((raw as { hr?: unknown }).hr);
    const x = Number((raw as { ax?: unknown }).ax);
    const y = Number((raw as { ay?: unknown }).ay);
    const z = Number((raw as { az?: unknown }).az);
    const deviceIdRaw = (raw as { deviceId?: unknown }).deviceId;
    const deviceId =
      typeof deviceIdRaw === "string" && deviceIdRaw.trim().length > 0
        ? deviceIdRaw.trim()
        : undefined;
    const rssiRaw = Number((raw as { wifi_rssi_dbm?: unknown }).wifi_rssi_dbm);
    const reconnectsRaw = Number(
      (raw as { wifi_reconnects?: unknown }).wifi_reconnects
    );

    const hasRequiredNumbers =
      this.isPositiveInteger(id) &&
      this.isNonNegativeNumber(sendUs) &&
      this.isNumberInRange(heartRate, 40, 220) &&
      this.isNumberInRange(x, -16, 16) &&
      this.isNumberInRange(y, -16, 16) &&
      this.isNumberInRange(z, -16, 16);

    if (!hasRequiredNumbers) {
      return null;
    }

    const magnitude = Number(Math.sqrt(x ** 2 + y ** 2 + z ** 2).toFixed(4));
    const sendUnit = detectSendUnit(sendUs, null);

    return {
      id,
      sendUs,
      timestamp: sendUnit === "us" ? sendUs / 1000 : sendUs,
      heartRate,
      acceleration: {
        x,
        y,
        z,
        magnitude
      },
      deviceId,
      wifiRssiDbm: Number.isFinite(rssiRaw) ? rssiRaw : null,
      wifiReconnects: Number.isFinite(reconnectsRaw) ? reconnectsRaw : null
    };
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

    const [seqRaw, sendRaw, heartRateRaw, axRaw, ayRaw, azRaw] = fields;
    const id = Number(seqRaw);
    const sendUs = Number(sendRaw);
    const heartRate = Number(heartRateRaw);
    const x = Number(axRaw);
    const y = Number(ayRaw);
    const z = Number(azRaw);

    const hasRequiredNumbers =
      this.isPositiveInteger(id) &&
      this.isNonNegativeNumber(sendUs) &&
      this.isNumberInRange(heartRate, 40, 220) &&
      this.isNumberInRange(x, -16, 16) &&
      this.isNumberInRange(y, -16, 16) &&
      this.isNumberInRange(z, -16, 16);

    if (!hasRequiredNumbers) {
      return null;
    }

    const magnitude = Number(Math.sqrt(x ** 2 + y ** 2 + z ** 2).toFixed(4));
    const sendUnit = detectSendUnit(sendUs, null);

    return {
      id,
      sendUs,
      timestamp: sendUnit === "us" ? sendUs / 1000 : sendUs,
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
