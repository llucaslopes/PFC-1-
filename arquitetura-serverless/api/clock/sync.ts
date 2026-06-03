import { performance } from "node:perf_hooks";
import type { VercelRequest, VercelResponse } from "../../lib/auth.js";

// POST /api/clock/sync  -- equivalente serverless do POST /clock/sync.
// Cristian/NTP simplificado: cliente passa clientT0; servidor responde
// com t1 (chegada) e t2 (saida) em ms desde o boot do worker.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ accepted: false, reason: "method_not_allowed" });
    return;
  }
  const body = (req.body ?? {}) as { clientT0?: unknown };
  const clientT0 = Number(body.clientT0);
  const t1 = performance.now();
  const t2 = performance.now();
  res.status(200).json({
    clientT0: Number.isFinite(clientT0) ? clientT0 : null,
    backendT1Ms: Number(t1.toFixed(3)),
    backendT2Ms: Number(t2.toFixed(3)),
    serverNowEpochMs: Date.now()
  });
}
