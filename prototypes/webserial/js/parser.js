import { els } from "./dom.js";
import { recordExperimentInvalid, recordExperimentSample } from "./experiment.js";
import { applySystemMetrics, pushInterArrival, stats } from "./metrics.js";
import { metricsState, serialState } from "./state.js";

export function parseCsvPayload(line) {
  const fields = line.split(",").map((field) => field.trim());
  if (fields.length !== 6) {
    return null;
  }

  const [seqRaw, sendMsRaw, hrRaw, axRaw, ayRaw, azRaw] = fields;
  const seq = Number(seqRaw);
  const sendMs = Number(sendMsRaw);
  const hr = Number(hrRaw);
  const ax = Number(axRaw);
  const ay = Number(ayRaw);
  const az = Number(azRaw);

  const isValid =
    Number.isInteger(seq) &&
    seq > 0 &&
    Number.isFinite(sendMs) &&
    sendMs >= 0 &&
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

  return { seq, sendMs, hr, ax, ay, az };
}

export function parseAndConsumeLines(chunk, receiveTime) {
  serialState.lineBuffer += chunk;
  const parts = serialState.lineBuffer.split("\n");
  serialState.lineBuffer = parts.pop() ?? "";

  for (const raw of parts) {
    const line = raw.replace(/\r$/, "");
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

function handleParsedLine({ seq, sendMs, hr, ax, ay, az }, receiveTime) {
  const processingStartedAt = performance.now();

  pushInterArrival(receiveTime);

  const { mean } = stats(metricsState.interArrivals);
  const throughput = metricsState.interArrivals.length ? 1000 / mean : 0;
  metricsState.totalMessages += 1;

  if (metricsState.lastSeq !== null && seq > metricsState.lastSeq + 1) {
    metricsState.lostMessages += seq - metricsState.lastSeq - 1;
  }
  metricsState.lastSeq = seq;

  els.lastLine.textContent = `${seq},${sendMs},${hr},${ax},${ay},${az}`;
  els.hr.textContent = String(hr);
  els.accel.textContent = `${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}`;
  els.throughput.textContent = throughput.toFixed(1);

  const processingLatencyMs = performance.now() - processingStartedAt;
  const magnitude = Math.sqrt(ax ** 2 + ay ** 2 + az ** 2);
  metricsState.processingLatencies.push(processingLatencyMs);
  metricsState.heartRates.push(hr);
  metricsState.accelerationMagnitudes.push(magnitude);
  recordExperimentSample({
    receivedAt: new Date().toISOString(),
    seq,
    sendMs,
    hr,
    ax,
    ay,
    az,
    accelerationMagnitude: magnitude,
    localProcessingLatencyMs: processingLatencyMs
  });
  applySystemMetrics(throughput, processingLatencyMs);
}
