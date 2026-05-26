import { setConnectionStatus } from "./dom.js";
import { applyHealth, applyMessage, applyMetrics } from "./dashboard.js";

export async function refreshSnapshots() {
  try {
    const [healthResponse, metricsResponse, latestResponse] = await Promise.all([
      fetch("/health"),
      fetch("/metrics"),
      fetch("/data/latest")
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
    const [healthResponse, metricsResponse] = await Promise.all([fetch("/health"), fetch("/metrics")]);

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
