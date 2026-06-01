import { ClockSyncMetadata } from "../../types";
import { computeCristianSync } from "../../utils/clockSyncMath";

export interface SyncSampleInput {
  legacy: boolean;
  t0: number;
  t3: number;
  arduinoT1Us?: number;
  arduinoT2Us?: number;
  arduinoMillis?: number;
}

export interface SyncSample {
  offsetMs: number;
  rttMs: number;
  uncertaintyMs: number;
  remoteUnit: "us" | "ms";
}

// Combina os timestamps (t0=envio do request, t3=chegada do reply) com
// os timestamps remotos (Arduino) para calcular offset/RTT/uncertainty.
// - Modo `us`: usa computeCristianSync com remoteUnit="us" (padrao novo).
// - Modo `ms` (legacy): formula simplificada (offsetMs = (t0+t3)/2 - millis).
// Retorna null quando os campos minimos estao faltando.
export function computeSyncSample(input: SyncSampleInput): SyncSample | null {
  if (input.legacy && input.arduinoMillis !== undefined) {
    const rttMs = input.t3 - input.t0;
    return {
      offsetMs: (input.t0 + input.t3) / 2 - input.arduinoMillis,
      rttMs,
      uncertaintyMs: rttMs / 2,
      remoteUnit: "ms"
    };
  }

  if (input.arduinoT1Us === undefined || input.arduinoT2Us === undefined) {
    return null;
  }

  const result = computeCristianSync({
    t0: input.t0,
    t1: input.arduinoT1Us,
    t2: input.arduinoT2Us,
    t3: input.t3,
    remoteUnit: "us"
  });

  return {
    offsetMs: result.offsetMs,
    rttMs: result.roundTripMs,
    uncertaintyMs: result.uncertaintyMs,
    remoteUnit: "us"
  };
}

// Seleciona a amostra de SYNC com menor RTT (mais "limpa") e formata o
// ClockSyncMetadata final, arredondando todos os campos numericos para
// 3 casas (mesma precisao usada em createSyncFailure / metricas).
export function selectBestSyncSample(
  samples: SyncSample[],
  attempts: number
): ClockSyncMetadata {
  const selected = [...samples].sort((a, b) => a.rttMs - b.rttMs)[0];
  const offsetMs = Number(selected.offsetMs.toFixed(3));
  const rttMs = Number(selected.rttMs.toFixed(3));
  const uncertaintyMs = Number(selected.uncertaintyMs.toFixed(3));

  return {
    arduinoToBackendOffsetMs: offsetMs,
    arduinoToBackendRttMs: rttMs,
    arduinoToBackendUncertaintyMs: uncertaintyMs,
    arduinoHostOffsetMs: offsetMs,
    arduinoHostRttMs: rttMs,
    arduinoHostUncertaintyMs: uncertaintyMs,
    arduinoRemoteUnit: selected.remoteUnit,
    frontendBackendOffsetMs: null,
    frontendBackendRttMs: null,
    frontendBackendUncertaintyMs: null,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: new Date().toISOString(),
    syncFailed: false
  };
}
