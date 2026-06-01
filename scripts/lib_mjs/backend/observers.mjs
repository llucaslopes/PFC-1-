
/**
 * Observadores WebSocket e REST polling para o orquestrador de backend.
 *
 * Extraido literalmente de `lib/backend-runner.mjs:174-350`:
 *   - `recordObservedMessage`: registra 1 amostra em state.samples com latencia
 *     calculada via sync NTP (ou fallback relativo).
 *   - `observeWebSocket`: abre WS e registra eventos `sensor-data` ate duration.
 *   - `observeRestPolling`: polling a cada intervalMs por `/data/latest`.
 *
 * Os 3 sao deterministicos dada a sequencia de mensagens recebidas (modulo
 * `performance.now()`, que e independente do conteudo).
 */

import { performance } from 'node:perf_hooks';

import { WebSocket } from 'ws';

import {
  computeEndToEndLatency,
  remoteSendToHostMs,
} from '../../lib/clockSyncMath.mjs';

const LATENCY_METHOD_SYNC = 'ntp_style_clock_synchronization';
const LATENCY_METHOD_FALLBACK = 'relative_offset_between_arduino_millis_and_frontend_performance_now';

export function toWsUrl(httpUrl) {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function recordObservedMessage({ message, state, clockSync, latencyCalibrator }) {
  const sensor = message.sensor;

  if (Date.parse(message.receivedAt) < Date.parse(state.startedAtIso)) {
    return;
  }

  const receiveMs = performance.now();
  const seq = sensor.id;

  if (state.lastObservedSeq !== null && seq > state.lastObservedSeq + 1) {
    state.observedSequenceGapMessages += seq - state.lastObservedSeq - 1;
  }
  state.lastObservedSeq = seq;

  const sendUs = message.arduinoSendUs ?? Math.round(sensor.sendUs ?? sensor.timestamp * 1000);
  const sendMs = sensor.timestamp;
  const relativeEstimatedLatencyMs = latencyCalibrator.calculate(sendMs, receiveMs);
  const backendToFrontendOffsetMs =
    clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs;
  const hasSynchronizedClock =
    clockSync &&
    !clockSync.syncFailed &&
    Number.isFinite(message.estimatedBackendSendTimeMs) &&
    Number.isFinite(backendToFrontendOffsetMs);
  const estimatedFrontendSendMs = hasSynchronizedClock
    ? remoteSendToHostMs(message.estimatedBackendSendTimeMs, 'ms', backendToFrontendOffsetMs)
    : null;
  const endToEndLatencyMs = hasSynchronizedClock
    ? computeEndToEndLatency(receiveMs, message.estimatedBackendSendTimeMs, 'ms', backendToFrontendOffsetMs)
    : relativeEstimatedLatencyMs;
  const latencyMethod = hasSynchronizedClock ? LATENCY_METHOD_SYNC : LATENCY_METHOD_FALLBACK;
  const clockUncertaintyMs = hasSynchronizedClock
    ? (message.backendArduinoClockUncertaintyMs ?? 0) +
      (clockSync.backendToFrontendUncertaintyMs ?? clockSync.frontendBackendUncertaintyMs ?? 0)
    : null;
  const syncRttMs = hasSynchronizedClock
    ? clockSync.backendToFrontendRttMs ?? clockSync.frontendBackendRttMs ?? null
    : null;

  state.samples.push({
    receivedAt: new Date().toISOString(),
    frontendReceiveMs: receiveMs,
    receiveMs,
    seq,
    sendUs,
    sendMs,
    hr: sensor.heartRate,
    ax: sensor.acceleration.x,
    ay: sensor.acceleration.y,
    az: sensor.acceleration.z,
    accelerationMagnitude: sensor.acceleration.magnitude,
    estimatedFrontendSendMs,
    endToEndLatencyMs,
    estimatedEndToEndLatencyMs: endToEndLatencyMs,
    relativeEstimatedLatencyMs,
    clockOffsetMs: hasSynchronizedClock ? backendToFrontendOffsetMs : null,
    clockSyncOffsetMs: hasSynchronizedClock ? backendToFrontendOffsetMs : null,
    clockUncertaintyMs,
    clockSyncUncertaintyMs: clockUncertaintyMs,
    syncRttMs,
    latencyMethod,
    localProcessingLatencyMs: 0,
  });
}

export async function observeWebSocket({ baseUrl, durationMs, state, clockSync, latencyCalibrator }) {
  return new Promise((resolveObserve, rejectObserve) => {
    const socket = new WebSocket(toWsUrl(baseUrl));
    let stopTimer = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (stopTimer) clearTimeout(stopTimer);
      try { socket.close(); } catch { /* ignore close errors */ }
      resolveObserve();
    };

    socket.on('open', () => {
      stopTimer = setTimeout(finish, durationMs);
    });

    socket.on('message', (data) => {
      try {
        const payload = JSON.parse(String(data));
        if (payload.type === 'sensor-data') {
          recordObservedMessage({ message: payload.data, state, clockSync, latencyCalibrator });
        }
      } catch (error) {
        console.warn(`[orchestrator] WS payload invalido: ${error.message}`);
      }
    });

    socket.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        if (stopTimer) clearTimeout(stopTimer);
        rejectObserve(error);
      }
    });

    socket.on('close', () => { finish(); });
  });
}

export async function observeRestPolling({
  baseUrl, durationMs, intervalMs, state, clockSync, latencyCalibrator,
}) {
  const seen = new Set();
  const deadline = Date.now() + durationMs;
  let running = true;

  async function poll() {
    if (!running) return;
    try {
      const response = await fetch(`${baseUrl}/data/latest`, { cache: 'no-store' });
      if (!response.ok) return;
      const message = await response.json();
      const seq = message?.sensor?.id;
      if (seq == null || seen.has(seq)) return;
      seen.add(seq);
      recordObservedMessage({ message, state, clockSync, latencyCalibrator });
    } catch {
      // transient error
    }
  }

  return new Promise((resolveObserve) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        running = false;
        clearInterval(timer);
        resolveObserve();
        return;
      }
      poll();
    }, intervalMs);
  });
}

export { LATENCY_METHOD_SYNC, LATENCY_METHOD_FALLBACK };
