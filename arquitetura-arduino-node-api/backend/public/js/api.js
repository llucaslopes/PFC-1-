import { setConnectionStatus } from "./dom.js";
import { applyHealth, applyMessage, applyMetrics } from "./dashboard.js";
import { resolveUrl } from "./target.js";

// Wrappers de fetch que respeitam o alvo ativo (A1/A2/A3). A3 usa
// `/api/...`; A1/A2 usam `/...` no mesmo origin do backend Node.

async function get(path) {
  return fetch(resolveUrl(path));
}

export async function refreshSnapshots() {
  try {
    const [healthResponse, metricsResponse, latestResponse] = await Promise.all([
      get("/health"),
      get("/metrics"),
      get("/data/latest")
    ]);

    if (healthResponse.ok) {
      applyHealth(await healthResponse.json());
    }

    if (metricsResponse.ok) {
      applyMetrics(await metricsResponse.json());
    }

    if (latestResponse.ok) {
      applyMessage(await latestResponse.json());
    }
  } catch {
    setConnectionStatus("Backend indisponivel", "offline");
  }
}

export async function refreshMetricsOnly() {
  try {
    const [healthResponse, metricsResponse] = await Promise.all([
      get("/health"),
      get("/metrics")
    ]);

    if (healthResponse.ok) {
      applyHealth(await healthResponse.json());
    }

    if (metricsResponse.ok) {
      applyMetrics(await metricsResponse.json());
    }
  } catch {
    setConnectionStatus("Backend indisponivel", "offline");
  }
}
