import { appendLog } from "./dom.js";
import { computeCristianSync } from "./clockSyncMath.js";
import { writeSerialCommand } from "./serial.js";
import { metricsState, serialState } from "./state.js";

export const CLOCK_SYNC_ATTEMPTS = 10;
export const LATENCY_METHOD_SYNC = "ntp_style_clock_synchronization";
export const LATENCY_METHOD_FALLBACK = "relative_offset_between_arduino_millis_and_frontend_performance_now";

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
      await sleep(20);
    } catch (error) {
      appendLog(`SYNC tentativa ${attempt} falhou: ${error.message}`);
    }
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
  const t0 = performance.now();
  const clientT0 = Math.round(t0 * 1000);
  const pending = createPendingSyncReply(clientT0);
  const sent = await writeSerialCommand(`SYNC,${clientT0}`);

  if (!sent) {
    removePendingSyncReply(pending);
    return null;
  }

  const reply = await withTimeout(pending.promise, 500).finally(() => {
    removePendingSyncReply(pending);
  });

  if (!reply.valid) {
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
    clientT0
  };
}

function createPendingSyncReply(clientT0) {
  const pending = { clientT0 };
  pending.promise = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    pending.reject = reject;
  });
  serialState.pendingSyncReplies.push(pending);
  return pending;
}

function removePendingSyncReply(pending) {
  const index = serialState.pendingSyncReplies.indexOf(pending);
  if (index >= 0) {
    serialState.pendingSyncReplies.splice(index, 1);
  }
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout aguardando SYNC_REPLY")), timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
