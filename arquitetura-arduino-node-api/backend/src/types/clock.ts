// Metadata de sincronizacao de relogio (Cristian/NTP simplificado) entre
// Arduino, backend e frontend. O sistema usa varios pares de offset/RTT/
// uncertainty porque cada hop pode ter caracteristicas distintas (USB
// serial vs HTTP/WebSocket).

export interface ClockSyncMetadata {
  arduinoToBackendOffsetMs?: number | null;
  arduinoToBackendRttMs?: number | null;
  arduinoToBackendUncertaintyMs?: number | null;
  arduinoHostOffsetMs: number | null;
  arduinoHostRttMs: number | null;
  arduinoHostUncertaintyMs: number | null;
  arduinoRemoteUnit?: "us" | "ms" | null;
  backendToFrontendOffsetMs?: number | null;
  backendToFrontendRttMs?: number | null;
  backendToFrontendUncertaintyMs?: number | null;
  frontendBackendOffsetMs: number | null;
  frontendBackendRttMs: number | null;
  frontendBackendUncertaintyMs: number | null;
  arduinoToFrontendOffsetMs?: number | null;
  arduinoToFrontendUncertaintyMs?: number | null;
  syncAttempts: number;
  selectedBy: "lowest_rtt";
  syncedAt: string | null;
  syncFailed: boolean;
  fallbackReason?: string;
}
