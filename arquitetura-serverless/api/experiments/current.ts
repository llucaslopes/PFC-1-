import { getJson } from "../../lib/storage.js";
import type { VercelRequest, VercelResponse } from "../../lib/auth.js";

// GET /api/experiments/current
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const current = (await getJson<Record<string, unknown>>("experiment:current")) ?? null;
  if (!current) {
    res.status(404).json({ message: "Nenhum experimento iniciado." });
    return;
  }
  res.status(200).json(current);
}
