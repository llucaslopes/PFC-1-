import { performance } from "node:perf_hooks";

// Adaptador da fonte MQTT ao contrato SensorInputStatusProvider que o
// backend Node ja consome para a fonte HTTP. Implementar a mesma
// interface deixa todas as rotas, services e testes do backend
// utilizaveis pela bridge sem mudar uma linha la dentro -- o que
// preserva a equivalencia metodologica entre A1/A2 e A4. A diferenca
// fica nas duas operacoes de ciclo de vida: nao ha conexao serial pra
// abrir e o sync de relogio nao precisa de RTT (ver synchronizeClock).
//
// Esta classe espelha arquitetura-arduino-node-api/backend/src/http/
// httpIntake.ts (a referencia canonica do contrato). Mantemos as duas
// implementacoes separadas porque a bridge eh um deployment .mjs
// independente do build TS do backend; o teste
// scripts/tests/test_collection_parity.mjs verifica que as duas
// produzem o mesmo `experiment-summary.json`.
export class MqttIntake {
  constructor() {
    this.connected = false;
    this.lastError = null;
    this.lastDeviceId = null;
    this.lastReceiveAt = null;
    this.totalIngested = 0;
    this.currentIntervalMs = 100;
  }

  start() {
    this.connected = false;
    console.log("[mqtt-intake] Pronto para receber mensagens em clube/+/sensor.");
  }

  getStatus() {
    return {
      source: "mqtt",
      configuredPort: null,
      baudRate: 0,
      connected: this.connected,
      lastError: this.lastError,
      lastDeviceId: this.lastDeviceId,
      lastReceiveAt: this.lastReceiveAt,
      totalIngested: this.totalIngested,
    };
  }

  setIntervalMs(intervalMs) {
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) return;
    this.currentIntervalMs = intervalMs;
    console.log(
      `[mqtt-intake] Intervalo configurado para ${intervalMs} ms (enviado em clube/<deviceId>/config quando suportado).`
    );
  }

  getCurrentIntervalMs() {
    return this.currentIntervalMs;
  }

  markIngested(deviceId) {
    this.connected = true;
    this.lastError = null;
    this.lastDeviceId = deviceId ?? this.lastDeviceId;
    this.lastReceiveAt = new Date().toISOString();
    this.totalIngested += 1;
  }

  markError(error) {
    this.lastError = error;
  }

  // Diferente do HttpIntake, nao ha handshake explicito porque o
  // ESP32 ja sincroniza com SNTP no boot e o send_us que ele anexa em
  // cada mensagem ja eh epoch absoluto. O offset reportado eh apenas
  // o deslocamento entre Date.now() e performance.now() do processo
  // Node, necessario para que a logica generica de calculo de latencia
  // (mesma em A1, A2 e A4) consiga converter os dois sem somar
  // referenciais incompativeis -- a causa raiz das latencias negativas
  // observadas na campanha preliminar.
  //
  // `_attempts` eh aceito apenas por compatibilidade de assinatura com
  // o SerialReader legado (que usava handshake SYNC,<id>). No caminho
  // MQTT ele eh ignorado de proposito -- o sufixo "_" sinaliza isso.
  async synchronizeClock(_attempts = 10, targetIntervalMs) {
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
      fallbackReason: "mqtt_sntp_absolute_epoch",
    };
  }
}
