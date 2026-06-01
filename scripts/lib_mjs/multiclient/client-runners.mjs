
/**
 * Clientes WebSocket e REST polling usados pela campanha multi-cliente.
 *
 * Cada cliente e independente: abre sua propria conexao, mantem seu proprio
 * estado de seq/perda, e calcula latencia usando o offset Arduino->frontend
 * ja resolvido (clockSync mesclado). Comportamento bit-a-bit identico ao
 * que estava inline em `run-multiclient-scalability.mjs:263-462`.
 */

import { performance } from 'node:perf_hooks';

import { WebSocket } from 'ws';

import {
  computeEndToEndLatency,
  remoteSendToHostMs,
} from '../../lib/clockSyncMath.mjs';

export function toWsUrl(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

export async function startExperiment({ baseUrl, payload }) {
  const response = await fetch(`${baseUrl}/experiments/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST /experiments/start: ${response.status} ${text}`);
  }
  return response.json();
}

export async function stopExperiment(baseUrl) {
  try {
    await fetch(`${baseUrl}/experiments/stop`, { method: 'POST', cache: 'no-store' });
  } catch {
    // ignore
  }
}

export async function resetExperiment(baseUrl) {
  try {
    await fetch(`${baseUrl}/experiments/reset`, { method: 'POST', cache: 'no-store' });
  } catch {
    // ignore
  }
}

/**
 * Cliente WebSocket que escuta sensor-data e registra latencia por amostra.
 */
export function runWebSocketClient({ baseUrl, durationMs, clockSync, clientId }) {
  return new Promise((resolveClient) => {
    const wsUrl = toWsUrl(baseUrl);
    const socket = new WebSocket(wsUrl);
    const samples = [];
    const seenSeq = new Set();
    let messages = 0;
    let lost = 0;
    let lastSeq = null;
    let firstReceiveMs = null;
    let lastReceiveMs = null;
    let errors = 0;
    let stopped = false;
    let stopTimer = null;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      if (stopTimer) clearTimeout(stopTimer);
      try { socket.close(); } catch { /* ignore */ }
      resolveClient({
        clientId,
        mode: 'websocket',
        messagesReceived: messages,
        uniqueSeqs: seenSeq.size,
        seqGapLost: lost,
        errors,
        firstReceiveMs,
        lastReceiveMs,
        samples,
      });
    };

    socket.on('open', () => {
      stopTimer = setTimeout(finish, durationMs);
    });

    socket.on('message', (data) => {
      try {
        const payload = JSON.parse(String(data));
        if (payload.type !== 'sensor-data') return;
        const message = payload.data;
        if (!message?.sensor) return;

        const receiveMs = performance.now();
        const seq = Number(message.sensor.id);
        if (!Number.isFinite(seq)) return;

        if (seenSeq.has(seq)) return;
        seenSeq.add(seq);
        messages++;
        if (firstReceiveMs === null) firstReceiveMs = receiveMs;
        lastReceiveMs = receiveMs;

        if (lastSeq !== null && seq > lastSeq + 1) {
          lost += seq - lastSeq - 1;
        }
        lastSeq = seq;

        const offsetMs =
          clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs ?? null;
        const rawSendBackend = message.estimatedBackendSendTimeMs;
        const sendBackendMs =
          rawSendBackend === null || rawSendBackend === undefined
            ? null
            : Number(rawSendBackend);
        // Calcula latencia se temos: (i) offset valido cliente<->backend
        // (sync deste orquestrador) e (ii) estimatedBackendSendTimeMs
        // realmente preenchido pelo backend (nao null - o backend devolve
        // null quando nao tem sync com Arduino, ex.: source=simulator).
        const hasSync =
          Number.isFinite(offsetMs) &&
          sendBackendMs !== null &&
          Number.isFinite(sendBackendMs);
        const latencyMs = hasSync
          ? computeEndToEndLatency(receiveMs, sendBackendMs, 'ms', offsetMs)
          : null;

        samples.push({
          seq,
          receiveMs,
          estimatedFrontendSendMs: hasSync ? remoteSendToHostMs(sendBackendMs, 'ms', offsetMs) : null,
          latencyMs,
        });
      } catch {
        errors++;
      }
    });

    socket.on('error', () => { errors++; });
    socket.on('close', () => finish());
  });
}

/**
 * Cliente REST polling: faz fetch /data/latest a cada intervalMs.
 * Mantem deduplicacao por seq para nao contar a mesma amostra duas vezes.
 */
export function runRestPollingClient({ baseUrl, durationMs, pollIntervalMs, clockSync, clientId }) {
  return new Promise((resolveClient) => {
    const samples = [];
    const seenSeq = new Set();
    let messages = 0;
    let lost = 0;
    let lastSeq = null;
    let firstReceiveMs = null;
    let lastReceiveMs = null;
    let errors = 0;
    let stopped = false;
    let inflight = false;
    const startedAt = performance.now();

    const offsetMs =
      clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs ?? null;
    const hasSyncOffset = Number.isFinite(offsetMs);

    const tick = async () => {
      if (stopped || inflight) return;
      inflight = true;
      try {
        const response = await fetch(`${baseUrl}/data/latest`, { cache: 'no-store' });
        if (!response.ok) {
          if (response.status !== 404) errors++;
          return;
        }
        const message = await response.json();
        if (!message?.sensor) return;

        const receiveMs = performance.now();
        const seq = Number(message.sensor.id);
        if (!Number.isFinite(seq)) return;
        if (seenSeq.has(seq)) return;

        seenSeq.add(seq);
        messages++;
        if (firstReceiveMs === null) firstReceiveMs = receiveMs;
        lastReceiveMs = receiveMs;

        if (lastSeq !== null && seq > lastSeq + 1) {
          lost += seq - lastSeq - 1;
        }
        lastSeq = seq;

        const sendBackendMsRaw = message.estimatedBackendSendTimeMs;
        const sendBackendMs =
          sendBackendMsRaw === null || sendBackendMsRaw === undefined
            ? null
            : Number(sendBackendMsRaw);
        const hasSync =
          hasSyncOffset && sendBackendMs !== null && Number.isFinite(sendBackendMs);
        const latencyMs = hasSync
          ? computeEndToEndLatency(receiveMs, sendBackendMs, 'ms', offsetMs)
          : null;

        samples.push({
          seq,
          receiveMs,
          estimatedFrontendSendMs: hasSync ? remoteSendToHostMs(sendBackendMs, 'ms', offsetMs) : null,
          latencyMs,
        });
      } catch {
        errors++;
      } finally {
        inflight = false;
      }
    };

    const timer = setInterval(() => {
      if (performance.now() - startedAt >= durationMs) {
        stopped = true;
        clearInterval(timer);
        resolveClient({
          clientId,
          mode: 'rest-polling',
          messagesReceived: messages,
          uniqueSeqs: seenSeq.size,
          seqGapLost: lost,
          errors,
          firstReceiveMs,
          lastReceiveMs,
          samples,
        });
        return;
      }
      void tick();
    }, pollIntervalMs);
  });
}
