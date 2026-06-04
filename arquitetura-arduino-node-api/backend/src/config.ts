import dotenv from "dotenv";

dotenv.config();

function readNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Environment variable ${name} must be a number.`);
  }

  return parsedValue;
}

export const config = {
  port: readNumberEnv("PORT", 3000),
  // Fontes suportadas: "wifi-http" (padrao, ESP32 + Wi-Fi),
  // "simulator" (para sanity-check sem hardware) e "serial" (legado USB,
  // mantido apenas para reprocessar campanhas antigas).
  sensorSource: process.env.SENSOR_SOURCE?.trim().toLowerCase() || "wifi-http",
  serialPort: process.env.SERIAL_PORT?.trim() || null,
  serialBaudRate: readNumberEnv("SERIAL_BAUD_RATE", 115200),
  simulatorIntervalMs: readNumberEnv("SIMULATOR_INTERVAL_MS", 100),
  apiKey: process.env.API_KEY?.trim() || null
};
