
/**
 * Amostragem periodica de CPU/RAM do backend via /health/process.
 * Extraido literalmente de `run-multiclient-scalability.mjs:464-528`.
 *
 * `summarizeResources` usa o mesmo `summarizeNumeric` (linear) por motivo
 * historico — NAO trocar por nearest-rank: quebra schema do
 * `consolidated_metrics.csv` da campanha multi-cliente.
 */

import { summarizeNumericLinear as summarizeNumeric } from '../stats.mjs';

export function startResourceSampler({ baseUrl, intervalMs }) {
  const samples = [];
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`${baseUrl}/health/process`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = await response.json();
      samples.push({
        sampledAt: payload.sampledAt,
        backendNowMs: payload.backendNowMs,
        cpuUsagePercent: payload.cpu?.usagePercent ?? null,
        cpuUserMs: payload.cpu?.deltaUserMs ?? null,
        cpuSystemMs: payload.cpu?.deltaSystemMs ?? null,
        memRssMb: payload.memory?.rssMb ?? null,
        memHeapUsedMb: payload.memory?.heapUsedMb ?? null,
        memHeapTotalMb: payload.memory?.heapTotalMb ?? null,
        websocketClients: payload.websocketClients ?? null,
      });
    } catch {
      // ignore
    }
  };

  // descarta a primeira leitura para resetar o delta de CPU sem poluir a serie
  void fetch(`${baseUrl}/health/process`, { cache: 'no-store' }).catch(() => {});

  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    getSamples() {
      return samples;
    },
  };
}

export function summarizeResources(samples) {
  if (!samples.length) {
    return {
      samples: 0,
      cpuUsagePercent: summarizeNumeric([]),
      memRssMb: summarizeNumeric([]),
      memHeapUsedMb: summarizeNumeric([]),
    };
  }
  return {
    samples: samples.length,
    cpuUsagePercent: summarizeNumeric(
      samples.map((s) => s.cpuUsagePercent).filter((v) => Number.isFinite(v))
    ),
    memRssMb: summarizeNumeric(
      samples.map((s) => s.memRssMb).filter((v) => Number.isFinite(v))
    ),
    memHeapUsedMb: summarizeNumeric(
      samples.map((s) => s.memHeapUsedMb).filter((v) => Number.isFinite(v))
    ),
  };
}
