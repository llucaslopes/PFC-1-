/**
 * Estima offset entre relogio remoto (Arduino) e host (performance.now em ms).
 * Convencao: hostMs = remoteMs + offsetMs
 * Incerteza aproximada: RTT/2 (limite superior da assimetria de ida/volta).
 */
export function computeCristianSync({ t0, t1, t2, t3, remoteUnit = "us" }) {
  const t1Ms = remoteUnit === "us" ? t1 / 1000 : t1;
  const t2Ms = remoteUnit === "us" ? t2 / 1000 : t2;
  const roundTripMs = (t3 - t0) - (t2Ms - t1Ms);
  const offsetMs = (t0 + t3) / 2 - (t1Ms + t2Ms) / 2;
  const uncertaintyMs = Math.max(0, roundTripMs / 2);

  return {
    roundTripMs,
    offsetMs,
    uncertaintyMs,
    remoteUnit
  };
}

export function remoteSendToHostMs(sendValue, remoteUnit, offsetMs) {
  const sendMs = remoteUnit === "us" ? sendValue / 1000 : sendValue;
  return sendMs + offsetMs;
}

export function detectSendUnit(sendValue, syncRemoteUnit) {
  if (syncRemoteUnit) {
    return syncRemoteUnit;
  }

  return sendValue >= 10_000_000 ? "us" : "ms";
}

export function computeEndToEndLatency(receiveMs, sendValue, remoteUnit, offsetMs) {
  if (!Number.isFinite(offsetMs) || !Number.isFinite(sendValue) || !Number.isFinite(receiveMs)) {
    return null;
  }

  const estimatedSendMs = remoteSendToHostMs(sendValue, remoteUnit, offsetMs);
  return Math.max(0, receiveMs - estimatedSendMs);
}
