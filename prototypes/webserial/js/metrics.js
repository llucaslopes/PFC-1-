import { els } from "./dom.js";
import { DISPLAY_TICK_MS, MAX_DISPLAY_STATS_SAMPLES, MAX_SAMPLES, metricsState } from "./state.js";
import { createLatencyCalibrator, numericStats } from "./scientific.js";

// Ticker UNICO de display (10 Hz). Idempotente: pode ser chamado por qualquer
// produtor de dados (serial connect, simulador start, experimento) sem
// duplicar intervals. Vive enquanto houver uma fonte ativa — o parser apenas
// grava snapshots em metricsState.lastDisplay e este ticker materializa no
// DOM. Antes desta refatoracao, o ticker so existia durante experimento,
// entao a UI ficava em "--" no modo "so conectado, sem experimento ativo".
let displayTickerId = null;

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
  metricsState.lastDisplay = null;
  metricsState.lastThroughput = 0;
  metricsState.lastSendUs = null;
  metricsState.rolloverDetectedCount = 0;
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

function tail(arr, n) {
  return arr.length > n ? arr.slice(-n) : arr;
}

export function applySystemMetrics(messagesPerSecond, latencyMs) {
  const expectedMessages =
    metricsState.totalMessages + metricsState.invalidMessages + metricsState.sequenceGapMessages;
  // Stats em tempo real usam apenas a janela final dos arrays. O calculo
  // completo (todas as N amostras) e feito apenas no fim do experimento em
  // createMetricsSnapshot, evitando trabalho O(N^2) por mensagem que
  // afogava o renderer no intervalo de 1 ms.
  const latencyStats = stats(tail(metricsState.processingLatencies, MAX_DISPLAY_STATS_SAMPLES));
  const endToEndStats = numericStats(
    tail(metricsState.endToEndLatencies, MAX_DISPLAY_STATS_SAMPLES)
  );
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

// Atualiza tudo que vai para o DOM em uma unica passada, a partir do snapshot
// gravado pelo parser. Chamado pelo display ticker (10 Hz). Em alta taxa
// (1 ms / ~280 msg/s) reduz reflows de ~1.120/s para ~50/s.
export function applyDisplayUpdate() {
  const snap = metricsState.lastDisplay;
  if (snap) {
    const { seq, sendUs, hr, ax, ay, az } = snap;
    els.lastLine.textContent = `${seq},${sendUs},${hr},${ax},${ay},${az}`;
    els.hr.textContent = String(hr);
    els.accel.textContent = `${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}`;
    els.throughput.textContent = metricsState.lastThroughput.toFixed(1);
  }
  applySystemMetrics(metricsState.lastThroughput, 0);
}

export function ensureDisplayTicker() {
  if (displayTickerId !== null) {
    return;
  }
  displayTickerId = setInterval(applyDisplayUpdate, DISPLAY_TICK_MS);
}

export function stopDisplayTicker() {
  if (displayTickerId === null) {
    return;
  }
  clearInterval(displayTickerId);
  displayTickerId = null;
  // Drena uma ultima passada para o DOM refletir os ultimos numeros.
  applyDisplayUpdate();
}

export function isDisplayTickerRunning() {
  return displayTickerId !== null;
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
