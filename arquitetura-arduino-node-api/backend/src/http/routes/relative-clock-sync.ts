import { ClockSyncMetadata } from "../../types";

// Helper usado em `experiments.start` quando a fonte eh simulador (ou o
// SerialReader nao expoe `synchronizeClock`). Retorna um ClockSyncMetadata
// marcando explicitamente que o clock sync falhou (fallback relativo),
// para que o frontend/clientes saibam usar latencyType="relative_fallback".
export function createRelativeFallbackClockSync(
  reason: string,
  attempts: number
): ClockSyncMetadata {
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    arduinoRemoteUnit: null,
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
