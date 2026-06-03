import { ClockSyncMetadata, SerialStatus } from "../types";

/**
 * Fonte de sensor por HTTP (Wi-Fi, ESP32). Substitui o SerialReader USB
 * em A1 e A2. Implementa o mesmo contrato (`SensorInputStatusProvider`)
 * para reaproveitar todas as rotas, services e tests existentes.
 *
 * Diferencas:
 *   - Nao abre porta serial.
 *   - `start()`/`getStatus()` reportam o ultimo POST /ingest/sensor recebido.
 *   - `synchronizeClock` retorna fallback relativo: o ESP32 ja se sincroniza
 *     via SNTP no boot. O alinhamento backend<->ESP32 e feito implicitamente
 *     pelo timestamp absoluto enviado no payload (`send_us` em microssegundos
 *     UNIX epoch quando SNTP estiver OK).
 *   - `setIntervalMs` apenas armazena o intervalo desejado para que o
 *     endpoint /config sirva ao ESP32 no proximo boot/poll.
 */
export class HttpIntake {
  private connected = false;
  private lastError: string | null = null;
  private lastDeviceId: string | null = null;
  private lastReceiveAt: string | null = null;
  private totalIngested = 0;
  private currentIntervalMs = 100;

  start(): void {
    this.connected = false;
    console.log(
      "[http-intake] Pronto para receber POST /ingest/sensor (ESP32 via Wi-Fi)."
    );
  }

  getStatus(): SerialStatus {
    return {
      source: "wifi-http",
      configuredPort: null,
      baudRate: 0,
      connected: this.connected,
      lastError: this.lastError,
      lastDeviceId: this.lastDeviceId,
      lastReceiveAt: this.lastReceiveAt,
      totalIngested: this.totalIngested
    };
  }

  setIntervalMs(intervalMs: number): void {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      return;
    }
    this.currentIntervalMs = intervalMs;
    console.log(
      `[http-intake] Intervalo configurado para ${intervalMs} ms (sera servido em GET /config).`
    );
  }

  getCurrentIntervalMs(): number {
    return this.currentIntervalMs;
  }

  /**
   * Marca uma amostra como recebida com sucesso. Chamado pela rota
   * /ingest/sensor depois que o sensorDataService aceitar o payload.
   */
  markIngested(deviceId: string | null | undefined): void {
    this.connected = true;
    this.lastError = null;
    this.lastDeviceId = deviceId ?? this.lastDeviceId;
    this.lastReceiveAt = new Date().toISOString();
    this.totalIngested += 1;
  }

  markError(error: string): void {
    this.lastError = error;
  }

  /**
   * Compatibilidade com a interface SensorInputStatusProvider. Em A1/A2
   * sobre Wi-Fi nao executamos o handshake SYNC,<id> serial; retornamos
   * um clockSync de fallback indicando que a referencia temporal vem
   * direto do `send_us` (epoch absoluto via SNTP no ESP32) ou marcando
   * fallback relativo.
   */
  async synchronizeClock(
    _attempts = 10,
    targetIntervalMs?: number
  ): Promise<ClockSyncMetadata> {
    if (typeof targetIntervalMs === "number") {
      this.setIntervalMs(targetIntervalMs);
    }
    return {
      arduinoToBackendOffsetMs: 0,
      arduinoToBackendRttMs: null,
      arduinoToBackendUncertaintyMs: null,
      arduinoHostOffsetMs: 0,
      arduinoHostRttMs: null,
      arduinoHostUncertaintyMs: null,
      arduinoRemoteUnit: "us",
      backendToFrontendOffsetMs: null,
      backendToFrontendRttMs: null,
      backendToFrontendUncertaintyMs: null,
      frontendBackendOffsetMs: null,
      frontendBackendRttMs: null,
      frontendBackendUncertaintyMs: null,
      arduinoToFrontendOffsetMs: null,
      arduinoToFrontendUncertaintyMs: null,
      syncAttempts: 0,
      selectedBy: "lowest_rtt",
      syncedAt: new Date().toISOString(),
      syncFailed: false,
      fallbackReason: "wifi_sntp_absolute_epoch"
    };
  }
}
