
/**
 * Recebe cada mensagem do backend (via WebSocket ou REST polling),
 * calcula latencias estimadas via clock-sync, e atualiza `state` +
 * indicador #latency do DOM.
 *
 * Extraido de `experiments.js` na Sub-fase 3.3. Logica de calculo de
 * latencia preservada bit-a-bit (mesmas cadeias `??` de fallback).
 */

import { LATENCY_METHOD_FALLBACK, LATENCY_METHOD_SYNC } from "../clockSync.js";
import { computeEndToEndLatency, remoteSendToHostMs } from "../clockSyncMath.js";
import { elements } from "../dom.js";
import { createLatencyCalibrator, numericStats } from "../scientific.js";
import { state } from "../state.js";

export function resetObservedData() {
  state.observedSamples = [];
  state.invalidMessages = [];
  state.latencyCalibrator = createLatencyCalibrator();
  state.clockSync = null;
  state.lastObservedSeq = null;
  state.observedLostMessages = 0;
  state.observedSequenceGapMessages = 0;
}

export function recordObservedMessage(message) {
  if (state.currentExperiment?.status !== "running") {
    return;
  }

  const startedAt = performance.now();
  const sensor = message.sensor;
  if (Date.parse(message.receivedAt) < Date.parse(state.currentExperiment.startedAt)) {
    return;
  }

  const receiveMs = performance.now();
  const seq = sensor.id;

  if (state.lastObservedSeq !== null && seq > state.lastObservedSeq + 1) {
    state.observedSequenceGapMessages += seq - state.lastObservedSeq - 1;
    state.observedLostMessages = state.observedSequenceGapMessages;
  }
  state.lastObservedSeq = seq;

  const sendUs = message.arduinoSendUs ?? Math.round(sensor.sendUs ?? sensor.timestamp * 1000);
  const sendMs = sensor.timestamp;
  const relativeEstimatedLatencyMs = state.latencyCalibrator.calculate(sendMs, receiveMs);
  const backendToFrontendOffsetMs =
    state.clockSync?.backendToFrontendOffsetMs ?? state.clockSync?.frontendBackendOffsetMs;
  const hasSynchronizedClock =
    state.clockSync &&
    !state.clockSync.syncFailed &&
    Number.isFinite(message.estimatedBackendSendTimeMs) &&
    Number.isFinite(backendToFrontendOffsetMs);
  const estimatedFrontendSendMs = hasSynchronizedClock
    ? remoteSendToHostMs(message.estimatedBackendSendTimeMs, "ms", backendToFrontendOffsetMs)
    : null;
  const endToEndLatencyMs = hasSynchronizedClock
    ? computeEndToEndLatency(receiveMs, message.estimatedBackendSendTimeMs, "ms", backendToFrontendOffsetMs)
    : relativeEstimatedLatencyMs;
  const latencyMethod = hasSynchronizedClock ? LATENCY_METHOD_SYNC : LATENCY_METHOD_FALLBACK;
  const clockUncertaintyMs = hasSynchronizedClock
    ? (message.backendArduinoClockUncertaintyMs ?? 0) +
      (state.clockSync.backendToFrontendUncertaintyMs ??
        state.clockSync.frontendBackendUncertaintyMs ??
        0)
    : null;
  const syncRttMs = hasSynchronizedClock
    ? (state.clockSync.backendToFrontendRttMs ?? state.clockSync.frontendBackendRttMs ?? null)
    : null;
  const localProcessingLatencyMs = performance.now() - startedAt;

  state.observedSamples.push({
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
    localProcessingLatencyMs
  });

  const latencyStats = numericStats(
    state.observedSamples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  elements.latency.textContent =
    latencyStats.average === null ? "--" : `${latencyStats.average.toFixed(3)} ms`;
}
