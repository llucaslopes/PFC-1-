import { ClockSyncMetadata } from "../../types";

// Cria o payload ClockSyncMetadata para indicar falha de SYNC, com o
// motivo (`reason`) e o numero de tentativas executadas. Todos os
// offsets/RTTs ficam null e `syncFailed=true`, sinalizando para o
// frontend usar fallback relativo (vide latencyType="relative_fallback").
export function createSyncFailure(reason: string, attempts: number): ClockSyncMetadata {
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    arduinoRemoteUnit: null,
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
