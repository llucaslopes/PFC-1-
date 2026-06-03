import { getJson, setJson } from "../../lib/storage.js";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../../lib/auth.js";

// POST /api/experiments/stop
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }
  if (!checkApiKey(req, res)) return;

  const current = (await getJson<Record<string, unknown>>("experiment:current")) ?? null;
  if (!current) {
    res.status(404).json({ message: "Nenhum experimento iniciado." });
    return;
  }
  const stopped = { ...current, status: "stopped" as const, stoppedAt: new Date().toISOString() };
  await setJson("experiment:current", stopped);
  res.status(200).json(stopped);
}
