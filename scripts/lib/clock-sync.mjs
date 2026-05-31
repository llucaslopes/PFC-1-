/**
 * Sincronizacao de relogio cliente <-> backend (estilo NTP/Cristian).
 *
 * Replica a logica usada por scripts/lib/backend-runner.mjs em uma forma
 * standalone, para que outros orquestradores (ex.: campanha de
 * escalabilidade horizontal com multiplos clientes) reutilizem sem precisar
 * tocar no runner original.
 */

import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { computeCristianSync } from "./clockSyncMath.mjs";

const DEFAULT_ATTEMPTS = 10;

export function createRelativeFallbackClockSync(reason = "sync_not_available", attempts = 0) {
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    backendToFrontendOffsetMs: null,
    backendToFrontendRttMs: null,
    backendToFrontendUncertaintyMs: null,
    frontendBackendOffsetMs: null,
    frontendBackendRttMs: null,
    frontendBackendUncertaintyMs: null,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: null,
    syncFailed: true,
    fallbackReason: reason
  };
}

/**
 * Sincroniza o relogio entre este processo (cliente) e o backend Node.js,
 * usando POST /clock/sync. Faz N tentativas e seleciona a amostra com menor
 * RTT (estilo Cristian). A incerteza retornada e RTT_min / 2.
 */
export async function synchronizeBackendClock(baseUrl, attempts = DEFAULT_ATTEMPTS) {
  const samples = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const t0 = performance.now();
      const response = await fetch(`${baseUrl}/clock/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ clientT0: t0 })
      });
      const payload = await response.json();
      const t3 = performance.now();
      const backendT1Ms = Number(payload.backendT1Ms);
      const backendT2Ms = Number(payload.backendT2Ms);

      if (!response.ok || !Number.isFinite(backendT1Ms) || !Number.isFinite(backendT2Ms)) {
        continue;
      }

      samples.push({
        t0,
        t3,
        ...computeCristianSync({ t0, t1: backendT1Ms, t2: backendT2Ms, t3, remoteUnit: "ms" })
      });
      await sleep(20);
    } catch {
      await sleep(20);
    }
  }

  if (!samples.length) {
    return createRelativeFallbackClockSync("backend_clock_sync_failed", attempts);
  }

  const selected = samples.sort((a, b) => a.roundTripMs - b.roundTripMs)[0];
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    backendToFrontendOffsetMs: selected.offsetMs,
    backendToFrontendRttMs: selected.roundTripMs,
    backendToFrontendUncertaintyMs: selected.uncertaintyMs,
    frontendBackendOffsetMs: selected.offsetMs,
    frontendBackendRttMs: selected.roundTripMs,
    frontendBackendUncertaintyMs: selected.uncertaintyMs,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: new Date().toISOString(),
    syncFailed: false
  };
}

/**
 * Mescla dois ClockSyncMetadata: o que veio do backend (Arduino<->backend, ja
 * computado pelo backend dentro de POST /experiments/start) e o que este
 * cliente computou (backend<->cliente). Compatibilidade com mergeClockSync do
 * backend-runner.mjs.
 */
export function mergeClockSync(backendArduinoSync, frontendBackendSync) {
  const backendFailed = backendArduinoSync?.syncFailed ?? true;
  const frontendFailed = frontendBackendSync?.syncFailed ?? true;
  const arduinoToBackendOffsetMs =
    backendArduinoSync?.arduinoToBackendOffsetMs ?? backendArduinoSync?.arduinoHostOffsetMs ?? null;
  const arduinoToBackendUncertaintyMs =
    backendArduinoSync?.arduinoToBackendUncertaintyMs ??
    backendArduinoSync?.arduinoHostUncertaintyMs ??
    null;
  const backendToFrontendOffsetMs =
    frontendBackendSync?.backendToFrontendOffsetMs ??
    frontendBackendSync?.frontendBackendOffsetMs ??
    null;
  const backendToFrontendUncertaintyMs =
    frontendBackendSync?.backendToFrontendUncertaintyMs ??
    frontendBackendSync?.frontendBackendUncertaintyMs ??
    null;
  const arduinoToFrontendOffsetMs =
    Number.isFinite(arduinoToBackendOffsetMs) && Number.isFinite(backendToFrontendOffsetMs)
      ? arduinoToBackendOffsetMs + backendToFrontendOffsetMs
      : null;
  const totalUncertaintyMs =
    Number.isFinite(arduinoToBackendUncertaintyMs) && Number.isFinite(backendToFrontendUncertaintyMs)
      ? arduinoToBackendUncertaintyMs + backendToFrontendUncertaintyMs
      : null;

  return {
    arduinoToBackendOffsetMs,
    arduinoToBackendRttMs:
      backendArduinoSync?.arduinoToBackendRttMs ?? backendArduinoSync?.arduinoHostRttMs ?? null,
    arduinoToBackendUncertaintyMs,
    arduinoHostOffsetMs: arduinoToBackendOffsetMs,
    arduinoHostRttMs:
      backendArduinoSync?.arduinoToBackendRttMs ?? backendArduinoSync?.arduinoHostRttMs ?? null,
    arduinoHostUncertaintyMs: arduinoToBackendUncertaintyMs,
    backendToFrontendOffsetMs,
    backendToFrontendRttMs:
      frontendBackendSync?.backendToFrontendRttMs ?? frontendBackendSync?.frontendBackendRttMs ?? null,
    backendToFrontendUncertaintyMs,
    frontendBackendOffsetMs: backendToFrontendOffsetMs,
    frontendBackendRttMs:
      frontendBackendSync?.backendToFrontendRttMs ?? frontendBackendSync?.frontendBackendRttMs ?? null,
    frontendBackendUncertaintyMs: backendToFrontendUncertaintyMs,
    arduinoToFrontendOffsetMs,
    arduinoToFrontendUncertaintyMs: totalUncertaintyMs,
    arduinoRemoteUnit: backendArduinoSync?.arduinoRemoteUnit ?? null,
    syncAttempts: Math.max(
      backendArduinoSync?.syncAttempts ?? 0,
      frontendBackendSync?.syncAttempts ?? 0
    ),
    selectedBy: "lowest_rtt",
    syncedAt: frontendBackendSync?.syncedAt ?? backendArduinoSync?.syncedAt ?? null,
    syncFailed: backendFailed || frontendFailed,
    fallbackReason:
      backendFailed || frontendFailed
        ? [backendArduinoSync?.fallbackReason, frontendBackendSync?.fallbackReason]
            .filter(Boolean)
            .join("; ") || "sync_failed"
        : undefined
  };
}
