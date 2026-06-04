import { performance } from "node:perf_hooks";
import { ClockSyncMetadata, SerialStatus } from "../types";

// Adaptador da fonte HTTP (POST /ingest/sensor) ao contrato
// SensorInputStatusProvider que o backend Node ja consumia para a
// fonte serial. Implementar a mesma interface manteve toda a stack
// (services, routes, tests) sem mudancas, e a unica logica especifica
// do transporte fica concentrada em synchronizeClock -- ver detalhes
// no comentario daquele metodo.
//
// Esta classe tem uma irma em arquitetura-mqtt/bridge/mqttIntake.mjs
// com o mesmo shape (start/getStatus/setIntervalMs/markIngested/
// markError/synchronizeClock). A duplicacao eh intencional: a bridge
// MQTT eh um deployment separado escrito em .mjs puro para nao
// depender do build do backend. Qualquer mudanca de contrato aqui
// (e.g. um novo campo em SerialStatus) precisa ser refletida la --
// e o teste scripts/tests/test_collection_parity.mjs verifica a
// equivalencia entre os dois pipelines.
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

  // O ESP32 ja sincroniza com SNTP no boot, entao send_us chega em
  // epoch absoluto (microssegundos desde 1970). O pipeline de metricas
  // do backend, porem, raciocina em performance.now() -- relativo ao
  // boot do processo Node. Sem reconciliar as duas escalas, a subtracao
  // que estima latencia fim-a-fim retorna ~ -1.78e12 ms; o codigo de
  // metricas grampeava esse negativo em zero, ocultando o problema e
  // produzindo as latencias zeradas vistas na campanha preliminar.
  //
  // O offset reportado segue a convencao "host_ms = remote_ms + offset"
  // do clock-sync.mjs: offset = performance.now() - Date.now(). Em
  // horizonte de uma rep (segundos a minutos) a deriva entre as duas
  // fontes eh sub-ms e cabe na incerteza ja documentada no relatorio.
  async synchronizeClock(
    _attempts = 10,
    targetIntervalMs?: number
  ): Promise<ClockSyncMetadata> {
    if (typeof targetIntervalMs === "number") {
      this.setIntervalMs(targetIntervalMs);
    }

    const epochMs = Date.now();
    const perfMs = performance.now();
    const arduinoToBackendOffsetMs = perfMs - epochMs;

    return {
      arduinoToBackendOffsetMs,
      arduinoToBackendRttMs: null,
      arduinoToBackendUncertaintyMs: null,
      arduinoHostOffsetMs: arduinoToBackendOffsetMs,
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
