// Tipos relacionados ao payload de sensor (ESP32/Wi-Fi -> backend ->
// clientes) e ao estado da fonte de ingestao. Separado de
// experiment/clock para reduzir acoplamento entre dominios.

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
  deviceId?: string;
  wifiRssiDbm?: number | null;
  wifiReconnects?: number | null;
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
  rolloverSuspected?: boolean;
  deviceId?: string;
  wifiRssiDbm?: number | null;
  wifiReconnects?: number | null;
  httpStatus?: number;
}

// Estado da fonte de dados. Mantemos o nome historico SerialStatus para nao
// quebrar baselines/tests, mas o `source` agora cobre tambem as fontes Wi-Fi.
export interface SerialStatus {
  source: "wifi-http" | "serial" | "simulator";
  configuredPort: string | null;
  baudRate: number;
  connected: boolean;
  lastError: string | null;
  // Diagnostico opcional para fontes HTTP (Wi-Fi).
  lastDeviceId?: string | null;
  lastReceiveAt?: string | null;
  totalIngested?: number;
}
