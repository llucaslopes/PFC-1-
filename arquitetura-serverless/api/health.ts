import { performance } from "node:perf_hooks";
import { MODULE_INIT_AT_MS } from "../lib/cold-start.js";
import type { VercelRequest, VercelResponse } from "../lib/auth.js";

// GET /api/health -- equivalente serverless do /health do backend Node.
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    status: "ok",
    moduleUptimeMs: Number((performance.now() - MODULE_INIT_AT_MS).toFixed(3)),
    region: process.env.VERCEL_REGION ?? null,
    deployment: process.env.VERCEL_DEPLOYMENT_ID ?? null
  });
}
