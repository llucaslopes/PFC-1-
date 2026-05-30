export type RemoteClockUnit = "us" | "ms";

export interface CristianSyncResult {
  roundTripMs: number;
  offsetMs: number;
  uncertaintyMs: number;
  remoteUnit: RemoteClockUnit;
}

/**
 * Offset: hostMs = remoteMs + offsetMs (converte tempo remoto para relogio do host).
 */
export function computeCristianSync(options: {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  remoteUnit?: RemoteClockUnit;
}): CristianSyncResult {
  const remoteUnit = options.remoteUnit ?? "us";
  const t1Ms = remoteUnit === "us" ? options.t1 / 1000 : options.t1;
  const t2Ms = remoteUnit === "us" ? options.t2 / 1000 : options.t2;
  const roundTripMs = (options.t3 - options.t0) - (t2Ms - t1Ms);
  const offsetMs = (options.t0 + options.t3) / 2 - (t1Ms + t2Ms) / 2;
  const uncertaintyMs = Math.max(0, roundTripMs / 2);

  return {
    roundTripMs,
    offsetMs,
    uncertaintyMs,
    remoteUnit
  };
}

export function remoteSendToHostMs(
  sendValue: number,
  remoteUnit: RemoteClockUnit,
  offsetMs: number
): number {
  const sendMs = remoteUnit === "us" ? sendValue / 1000 : sendValue;
  return sendMs + offsetMs;
}

export function detectSendUnit(sendValue: number, syncRemoteUnit?: RemoteClockUnit | null): RemoteClockUnit {
  if (syncRemoteUnit) {
    return syncRemoteUnit;
  }

  return sendValue >= 10_000_000 ? "us" : "ms";
}
