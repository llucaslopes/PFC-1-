// Hardening minimo: se INGEST_API_KEY estiver setada, validamos o
// header `x-api-key` em endpoints de ingestao/escrita. Endpoints de
// leitura (data/latest, metrics, health) ficam abertos para nao
// quebrar o dashboard.

import type { VercelRequest, VercelResponse } from "@vercel/node";

export function checkApiKey(req: VercelRequest, res: VercelResponse): boolean {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) return true;
  const provided = String(req.headers["x-api-key"] ?? "");
  if (provided !== expected) {
    res.status(401).json({ accepted: false, reason: "unauthorized" });
    return false;
  }
  return true;
}

export type { VercelRequest, VercelResponse };
