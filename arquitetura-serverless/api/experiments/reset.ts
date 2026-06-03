import { deleteKey, resetMetrics } from "../../lib/storage.js";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../../lib/auth.js";

// POST /api/experiments/reset
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }
  if (!checkApiKey(req, res)) return;
  await Promise.all([resetMetrics(), deleteKey("experiment:current")]);
  res.status(204).end();
}
