import { setJson } from "../../lib/storage.js";
import { checkApiKey, type VercelRequest, type VercelResponse } from "../../lib/auth.js";

// POST /api/experiments/observations  -- equivalente do mesmo endpoint
// no backend Node. Apenas guarda o payload bruto da observacao do
// frontend para inclusao no summaryJson final.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }
  if (!checkApiKey(req, res)) return;
  const observation = (req.body ?? {}) as Record<string, unknown>;
  const experimentId =
    typeof observation.experimentId === "string" ? observation.experimentId : null;
  if (!experimentId) {
    res.status(400).json({ accepted: false, reason: "missing_experimentId" });
    return;
  }
  await setJson(`observation:${experimentId}`, observation);
  res.status(204).end();
}
