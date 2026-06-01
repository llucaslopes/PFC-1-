// Tipos relacionados ao payload de sensor (Arduino -> backend -> clientes)
// e ao estado da fonte serial/simulador. Separado de experiment/clock para
// reduzir acoplamento entre dominios.

export interface AccelerationPayload {
  x: number;
  y: number;
  z: number;
  magnitude: number;
}

export interface SensorPayload {
  id: number;
  sendUs: number;
  timestamp: number;
  heartRate: number;
  acceleration: AccelerationPayload;
}

export interface ProcessedSensorMessage {
  sensor: SensorPayload;
  receivedAt: string;
  backendReceiveMs: number;
  arduinoSendUs: number;
  estimatedBackendSendTimeMs: number | null;
  backendArduinoClockOffsetMs: number | null;
  backendArduinoClockUncertaintyMs: number | null;
  processingLatencyMs: number;
  // Marcado quando o backend detecta que o sendUs caiu abaixo do anterior
  // (rollover do micros() do Arduino a cada ~71,58 min). Latencia desta
  // amostra fica indefinida e nao deve ser usada nas estatisticas.
  rolloverSuspected?: boolean;
}

export interface SerialStatus {
  source: "serial" | "simulator";
  configuredPort: string | null;
  baudRate: number;
  connected: boolean;
  lastError: string | null;
}
