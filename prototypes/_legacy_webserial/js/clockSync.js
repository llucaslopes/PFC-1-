import { appendLog } from "./dom.js";
import { computeCristianSync } from "./clockSyncMath.js";
import { writeSerialCommand } from "./serial.js";
import { metricsState, serialState } from "./state.js";

export const CLOCK_SYNC_ATTEMPTS = 10;
export const SYNC_TIMEOUT_MS = 2000;
export const SYNC_INTER_ATTEMPT_MS = 50;
export const SYNC_SAFE_INTERVAL_MS = 100;
export const SYNC_DRAIN_MS = 250;
export const LATENCY_METHOD_SYNC = "ntp_style_clock_synchronization";
export const LATENCY_METHOD_FALLBACK = "relative_offset_between_arduino_millis_and_frontend_performance_now";

const SYNC_ID_LIMIT = 1_000_000_000;

export function createRelativeFallbackClockSync(reason = "sync_not_available", attempts = 0) {
  return {
    arduinoToFrontendOffsetMs: null,
    arduinoToFrontendRttMs: null,
    arduinoToFrontendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    frontendBackendOffsetMs: null,
    frontendBackendRttMs: null,
    frontendBackendUncertaintyMs: null,
    arduinoRemoteUnit: null,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: null,
    syncFailed: true,
    fallbackReason: reason
  };
}

/**
 * Executa o SYNC NTP/Cristian com o Arduino. Para evitar contencao da serial,
 * e dever do CHAMADOR colocar o Arduino em estado idle (intervalo seguro de
 * 100 ms) antes de chamar esta funcao. Veja `experiment.js`.
 */
export async function synchronizeArduinoClock(attempts = CLOCK_SYNC_ATTEMPTS) {
  if (!serialState.port?.writable) {
    return createRelativeFallbackClockSync("serial_port_not_writable", 0);
  }

  const samples = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const sample = await runSyncAttempt();
      if (sample) {
        samples.push(sample);
      }
    } catch (error) {
      appendLog(`SYNC tentativa ${attempt} falhou: ${error.message}`);
    }
    await sleep(SYNC_INTER_ATTEMPT_MS);
  }

  if (!samples.length) {
    const failed = createRelativeFallbackClockSync("no_valid_sync_reply", attempts);
    metricsState.clockSync = failed;
    return failed;
  }

  const selected = samples.sort((a, b) => a.roundTripMs - b.roundTripMs)[0];
  const clockSync = buildArduinoClockSync(selected, attempts);
  metricsState.clockSync = clockSync;
  appendLog(
    `SYNC Arduino: RTT ${selected.roundTripMs.toFixed(3)} ms, offset ${selected.offsetMs.toFixed(3)} ms, incerteza ${selected.uncertaintyMs.toFixed(3)} ms.`
  );
  return clockSync;
}

function buildArduinoClockSync(selected, attempts) {
  return {
    arduinoToFrontendOffsetMs: selected.offsetMs,
    arduinoToFrontendRttMs: selected.roundTripMs,
    arduinoToFrontendUncertaintyMs: selected.uncertaintyMs,
    arduinoHostOffsetMs: selected.offsetMs,
    arduinoHostRttMs: selected.roundTripMs,
    arduinoHostUncertaintyMs: selected.uncertaintyMs,
    frontendBackendOffsetMs: null,
    frontendBackendRttMs: null,
    frontendBackendUncertaintyMs: null,
    arduinoRemoteUnit: selected.remoteUnit,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: new Date().toISOString(),
    syncFailed: false,
    samples: selected
  };
}

async function runSyncAttempt() {
  const syncId = nextSyncId();
  const t0 = performance.now();
  const pending = registerPendingSync(syncId, t0);
  const sent = await writeSerialCommand(`SYNC,${syncId}`);

  if (!sent) {
    cancelPendingSync(syncId);
    return null;
  }

  let reply;
  try {
    reply = await pending.promise;
  } catch (error) {
    cancelPendingSync(syncId);
    throw error;
  }

  if (!reply || reply.valid === false) {
    return null;
  }

  const t3 = reply.receivedAtMs;

  if (reply.legacy) {
    const roundTripMs = t3 - t0;
    const offsetMs = (t0 + t3) / 2 - reply.arduinoMillis;
    return {
      t0,
      t3,
      roundTripMs,
      offsetMs,
      uncertaintyMs: roundTripMs / 2,
      remoteUnit: "ms"
    };
  }

  return {
    ...computeCristianSync({
      t0,
      t1: reply.arduinoT1Us,
      t2: reply.arduinoT2Us,
      t3,
      remoteUnit: "us"
    }),
    t0,
    t3,
    syncId
  };
}

function nextSyncId() {
  const id = serialState.nextSyncId;
  serialState.nextSyncId = id + 1 > SYNC_ID_LIMIT ? 1 : id + 1;
  return id;
}

function registerPendingSync(syncId, t0) {
  const pending = { syncId, t0 };
  pending.promise = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
    pending.timer = window.setTimeout(() => {
      if (serialState.pendingSyncReplies.get(syncId) === pending) {
        serialState.pendingSyncReplies.delete(syncId);
        reject(new Error("timeout aguardando SYNC_REPLY"));
      }
    }, SYNC_TIMEOUT_MS);
  });
  serialState.pendingSyncReplies.set(syncId, pending);
  return pending;
}

function cancelPendingSync(syncId) {
  const pending = serialState.pendingSyncReplies.get(syncId);
  if (!pending) {
    return;
  }
  window.clearTimeout(pending.timer);
  serialState.pendingSyncReplies.delete(syncId);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
