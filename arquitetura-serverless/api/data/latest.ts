import { getJson, listSamples, type StoredSample } from "../../lib/storage.js";
import type { VercelRequest, VercelResponse } from "../../lib/auth.js";

// GET /api/data/latest?deviceId=esp32-01
// Devolve a ultima amostra do dispositivo (default = "esp32-01"). Se
// `since=<seq>` for passado, retorna apenas amostras com seq > since.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }

  const deviceId =
    typeof req.query.deviceId === "string" ? req.query.deviceId : "esp32-01";
  const sinceParam =
    typeof req.query.since === "string" ? Number(req.query.since) : null;

  if (sinceParam !== null && Number.isFinite(sinceParam)) {
    const samples = await listSamples(deviceId, 100);
    const filtered = samples.filter((s) => s.seq > sinceParam);
    res.status(200).json({ deviceId, samples: filtered });
    return;
  }

  const latest = await getJson<StoredSample>(`latest:${deviceId}`);
  if (!latest) {
    res
      .status(404)
      .json({ message: "Nenhuma amostra recebida ainda para este dispositivo." });
    return;
  }
  res.status(200).json(latest);
}
