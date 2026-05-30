import { els } from "./dom.js";
import { MAX_SAMPLES, metricsState } from "./state.js";
import { createLatencyCalibrator, numericStats } from "./scientific.js";

export function pushInterArrival(now) {
  if (metricsState.lastArrival != null) {
    const dt = now - metricsState.lastArrival;
    metricsState.interArrivals.push(dt);
    if (metricsState.interArrivals.length > MAX_SAMPLES) {
      metricsState.interArrivals.shift();
    }
  }
  metricsState.lastArrival = now;
}

export function stats(arr) {
  if (!arr.length) {
    return { samples: 0, mean: null, min: null, max: null, std: null };
  }

  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, value) => sum + (value - mean) ** 2, 0) / arr.length;

  return {
    samples: arr.length,
    mean,
    min: Math.min(...arr),
    max: Math.max(...arr),
    std: Math.sqrt(variance)
  };
}

export function percent(part, total) {
  if (total <= 0) {
    return 0;
  }

  return (part / total) * 100;
}

export function resetMetrics() {
  metricsState.lastArrival = null;
  metricsState.lastSeq = null;
  metricsState.totalMessages = 0;
  metricsState.invalidMessages = 0;
  metricsState.lostMessages = 0;
  metricsState.sequenceGapMessages = 0;
  metricsState.latencyCalibrator = createLatencyCalibrator();
  metricsState.clockSync = null;
  metricsState.interArrivals.length = 0;
  metricsState.endToEndLatencies.length = 0;
  metricsState.processingLatencies.length = 0;
  metricsState.heartRates.length = 0;
  metricsState.accelerationMagnitudes.length = 0;
  els.throughput.textContent = "--";
  els.totalMessages.textContent = "0";
  els.invalidMessages.textContent = "0";
  els.lostMessages.textContent = "0";
  els.messagesPerSecond.textContent = "0";
  els.latency.textContent = "--";
  els.averageLatency.textContent = "--";
  els.lostPercent.textContent = "0%";
  els.invalidPercent.textContent = "0%";
}

export function applySystemMetrics(messagesPerSecond, latencyMs) {
  const expectedMessages =
    metricsState.totalMessages + metricsState.invalidMessages + metricsState.sequenceGapMessages;
  const latencyStats = stats(metricsState.processingLatencies);
  const endToEndStats = numericStats(metricsState.endToEndLatencies);
  const missingMessages = Math.max(0, expectedMessages - metricsState.totalMessages);

  els.totalMessages.textContent = String(metricsState.totalMessages);
  els.invalidMessages.textContent = String(metricsState.invalidMessages);
  els.lostMessages.textContent = String(missingMessages);
  els.messagesPerSecond.textContent = messagesPerSecond.toFixed(3);
  els.latency.textContent =
    endToEndStats.average === null ? "--" : `${endToEndStats.average.toFixed(3)} ms`;
  els.averageLatency.textContent =
    latencyStats.mean === null ? "--" : `${latencyStats.mean.toFixed(3)} ms`;
  els.lostPercent.textContent = `${percent(missingMessages, expectedMessages).toFixed(3)}%`;
  els.invalidPercent.textContent = `${percent(metricsState.invalidMessages, expectedMessages).toFixed(
    3
  )}%`;
}

export function serializeStats(value) {
  return {
    samples: value.samples,
    average: value.mean === null ? null : Number(value.mean.toFixed(3)),
    min: value.min === null ? null : Number(value.min.toFixed(3)),
    max: value.max === null ? null : Number(value.max.toFixed(3)),
    standardDeviation: value.std === null ? null : Number(value.std.toFixed(3))
  };
}
