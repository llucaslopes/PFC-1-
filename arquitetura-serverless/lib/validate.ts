// Validacao do payload JSON enviado pelo ESP32. Espelha as regras do
// SensorDataService.normalizeJsonPayload() do backend Node, para que A3
// rejeite/aceite exatamente o mesmo conjunto de payloads que A1/A2.

export interface SensorPayloadRaw {
  deviceId?: string;
  seq?: unknown;
  send_us?: unknown;
  sendUs?: unknown;
  hr?: unknown;
  ax?: unknown;
  ay?: unknown;
  az?: unknown;
  wifi_rssi_dbm?: unknown;
  wifi_reconnects?: unknown;
}

export interface SensorPayloadNormalized {
  deviceId: string;
  seq: number;
  sendUs: number;
  hr: number;
  ax: number;
  ay: number;
  az: number;
  wifiRssiDbm: number | null;
  wifiReconnects: number | null;
  magnitude: number;
}

const isPositiveInteger = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
const isNonNegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const isInRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

export function validateSensorPayload(
  raw: SensorPayloadRaw
): { ok: true; payload: SensorPayloadNormalized } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "invalid_body" };
  }

  const deviceId =
    typeof raw.deviceId === "string" && raw.deviceId.trim().length > 0
      ? raw.deviceId.trim()
      : null;
  if (!deviceId) {
    return { ok: false, reason: "missing_deviceId" };
  }

  const seq = Number(raw.seq);
  const sendUs = Number(raw.send_us ?? raw.sendUs);
  const hr = Number(raw.hr);
  const ax = Number(raw.ax);
  const ay = Number(raw.ay);
  const az = Number(raw.az);

  if (!isPositiveInteger(seq)) return { ok: false, reason: "invalid_seq" };
  if (!isNonNegative(sendUs)) return { ok: false, reason: "invalid_send_us" };
  if (!isInRange(hr, 40, 220)) return { ok: false, reason: "invalid_hr" };
  if (!isInRange(ax, -16, 16)) return { ok: false, reason: "invalid_ax" };
  if (!isInRange(ay, -16, 16)) return { ok: false, reason: "invalid_ay" };
  if (!isInRange(az, -16, 16)) return { ok: false, reason: "invalid_az" };

  const rssi = Number(raw.wifi_rssi_dbm);
  const reconnects = Number(raw.wifi_reconnects);
  const magnitude = Number(Math.sqrt(ax ** 2 + ay ** 2 + az ** 2).toFixed(4));

  return {
    ok: true,
    payload: {
      deviceId,
      seq,
      sendUs,
      hr,
      ax,
      ay,
      az,
      wifiRssiDbm: Number.isFinite(rssi) ? rssi : null,
      wifiReconnects: Number.isFinite(reconnects) ? reconnects : null,
      magnitude
    }
  };
}
