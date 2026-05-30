import { els } from "./dom.js";
import { LATENCY_METHOD_FALLBACK, LATENCY_METHOD_SYNC } from "./clockSync.js";
import {
  computeEndToEndLatency,
  detectSendUnit,
  remoteSendToHostMs
} from "./clockSyncMath.js";
import { recordExperimentInvalid, recordExperimentSample } from "./experiment.js";
import { applySystemMetrics, pushInterArrival, stats } from "./metrics.js";
import { metricsState, serialState } from "./state.js";

export function parseCsvPayload(line) {
  const fields = line.split(",").map((field) => field.trim());
  if (fields.length !== 6) {
    return null;
  }

  const [seqRaw, sendRaw, hrRaw, axRaw, ayRaw, azRaw] = fields;
  const seq = Number(seqRaw);
  const sendValue = Number(sendRaw);
  const hr = Number(hrRaw);
  const ax = Number(axRaw);
  const ay = Number(ayRaw);
  const az = Number(azRaw);

  const isValid =
    Number.isInteger(seq) &&
    seq > 0 &&
    Number.isFinite(sendValue) &&
    sendValue >= 0 &&
    Number.isFinite(hr) &&
    hr >= 40 &&
    hr <= 220 &&
    Number.isFinite(ax) &&
    ax >= -16 &&
    ax <= 16 &&
    Number.isFinite(ay) &&
    ay >= -16 &&
    ay <= 16 &&
    Number.isFinite(az) &&
    az >= -16 &&
    az <= 16;

  if (!isValid) {
    return null;
  }

  return { seq, sendValue, hr, ax, ay, az };
}

export function parseAndConsumeLines(chunk, receiveTime) {
  serialState.lineBuffer += chunk;
  const parts = serialState.lineBuffer.split("\n");
  serialState.lineBuffer = parts.pop() ?? "";

  for (const raw of parts) {
    const line = raw.replace(/\r$/, "");
    if (consumeSyncReply(line, receiveTime)) {
      continue;
    }

    const parsed = parseCsvPayload(line);
    if (!parsed) {
      if (line.trim()) {
        metricsState.invalidMessages += 1;
        recordExperimentInvalid(line);
        els.invalidMessages.textContent = String(metricsState.invalidMessages);
      }
      continue;
    }

    handleParsedLine(parsed, receiveTime);
  }
}

function consumeSyncReply(line, receiveTime) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("SYNC_REPLY,")) {
    return false;
  }

  const payload = trimmed.slice("SYNC_REPLY,".length);
  const fields = payload.split(",").map((field) => field.trim());
  const pending = serialState.pendingSyncReplies.shift();

  if (!pending) {
    return true;
  }

  if (fields.length >= 3) {
    const clientT0 = Number(fields[0]);
    const arduinoT1Us = Number(fields[1]);
    const arduinoT2Us = Number(fields[2]);
    pending.resolve({
      clientT0,
      arduinoT1Us,
      arduinoT2Us,
      receivedAtMs: receiveTime,
      legacy: false,
      valid:
        Number.isFinite(arduinoT1Us) &&
        arduinoT1Us >= 0 &&
        Number.isFinite(arduinoT2Us) &&
        arduinoT2Us >= 0
    });
    return true;
  }

  const arduinoMillis = Number(fields[0]);
  pending.resolve({
    arduinoMillis,
    receivedAtMs: receiveTime,
    legacy: true,
    valid: Number.isFinite(arduinoMillis) && arduinoMillis >= 0
  });
  return true;
}

function handleParsedLine({ seq, sendValue, hr, ax, ay, az }, receiveTime) {
  const processingStartedAt = performance.now();
  const clockSync = metricsState.clockSync;
  const hasSynchronizedClock =
    clockSync && !clockSync.syncFailed && Number.isFinite(clockSync.arduinoToFrontendOffsetMs);
  const sendUnit = detectSendUnit(sendValue, clockSync?.arduinoRemoteUnit);
  const sendUs = sendUnit === "us" ? sendValue : sendValue * 1000;
  const sendMs = sendUnit === "us" ? sendValue / 1000 : sendValue;
  const relativeEstimatedLatencyMs =
    metricsState.latencyCalibrator?.calculate(sendMs, receiveTime) ?? null;
  const estimatedFrontendSendMs = hasSynchronizedClock
    ? remoteSendToHostMs(sendValue, sendUnit, clockSync.arduinoToFrontendOffsetMs)
    : null;
  const endToEndLatencyMs = hasSynchronizedClock
    ? computeEndToEndLatency(receiveTime, sendValue, sendUnit, clockSync.arduinoToFrontendOffsetMs)
    : relativeEstimatedLatencyMs;
  const latencyMethod = hasSynchronizedClock ? LATENCY_METHOD_SYNC : LATENCY_METHOD_FALLBACK;
  const clockUncertaintyMs = hasSynchronizedClock ? clockSync.arduinoToFrontendUncertaintyMs : null;
  const syncRttMs = hasSynchronizedClock ? clockSync.arduinoToFrontendRttMs : null;

  pushInterArrival(receiveTime);
  const { mean } = stats(metricsState.interArrivals);
  const throughput = metricsState.interArrivals.length ? 1000 / mean : 0;
  metricsState.totalMessages += 1;

  if (metricsState.lastSeq !== null && seq > metricsState.lastSeq + 1) {
    metricsState.sequenceGapMessages += seq - metricsState.lastSeq - 1;
    metricsState.lostMessages = metricsState.sequenceGapMessages;
  }
  metricsState.lastSeq = seq;

  els.lastLine.textContent = `${seq},${sendUs},${hr},${ax},${ay},${az}`;
  els.hr.textContent = String(hr);
  els.accel.textContent = `${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}`;
  els.throughput.textContent = throughput.toFixed(1);

  const processingLatencyMs = performance.now() - processingStartedAt;
  const magnitude = Math.sqrt(ax ** 2 + ay ** 2 + az ** 2);
  metricsState.endToEndLatencies.push(endToEndLatencyMs);
  metricsState.processingLatencies.push(processingLatencyMs);
  metricsState.heartRates.push(hr);
  metricsState.accelerationMagnitudes.push(magnitude);
  recordExperimentSample({
    receivedAt: new Date().toISOString(),
    frontendReceiveMs: receiveTime,
    receiveMs: receiveTime,
    seq,
    sendUs,
    sendMs,
    sendValue,
    hr,
    ax,
    ay,
    az,
    accelerationMagnitude: magnitude,
    estimatedFrontendSendMs,
    endToEndLatencyMs,
    estimatedEndToEndLatencyMs: endToEndLatencyMs,
    relativeEstimatedLatencyMs,
    clockOffsetMs: hasSynchronizedClock ? clockSync.arduinoToFrontendOffsetMs : null,
    clockSyncOffsetMs: hasSynchronizedClock ? clockSync.arduinoToFrontendOffsetMs : null,
    clockUncertaintyMs,
    clockSyncUncertaintyMs: clockUncertaintyMs,
    syncRttMs,
    latencyMethod,
    localProcessingLatencyMs: processingLatencyMs
  });
  applySystemMetrics(throughput, processingLatencyMs);
}
