import { getJson, setJson } from "../lib/storage.js";
import type { VercelRequest, VercelResponse } from "../lib/auth.js";

// GET  /api/config?deviceId=esp32-01  -> { intervalMs }
// POST /api/config { deviceId, intervalMs } -> grava intervalMs corrente
//
// Permite o orquestrador trocar o intervalo do ESP32 sem reflashar o sketch
// (o ESP32 puxa este endpoint no boot).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    const intervalMs =
      ((await getJson<number>("config:intervalMs")) as number | null) ?? 100;
    res.status(200).json({ intervalMs });
    return;
  }
  if (req.method === "POST") {
    const body = (req.body ?? {}) as { intervalMs?: number };
    const intervalMs = Number(body.intervalMs);
    if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
      res.status(400).json({ accepted: false, reason: "invalid_interval" });
      return;
    }
    await setJson("config:intervalMs", intervalMs);
    res.status(200).json({ intervalMs });
    return;
  }
  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ accepted: false, reason: "method_not_allowed" });
}
