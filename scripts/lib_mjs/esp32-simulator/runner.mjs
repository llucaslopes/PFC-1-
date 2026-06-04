// Loop de envio do simulador. Espelha a politica do firmware do ESP32:
// envio sequencial controlado por relogio, sem fila quando a rede esta
// lenta. Quando o RTT da iteracao anterior estoura o intervalMs, as
// janelas perdidas sao contabilizadas como localDrops -- a metrica
// equivale ao que aconteceria no ESP32, onde amostras "atrasadas" sao
// descartadas em vez de empilhadas. Sem essa contabilizacao, um
// simulador rodando em rede lenta pareceria estar enviando em
// frequencia menor sem deixar rastro disso nos resultados.

import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";

import { buildPayload } from "./payload.mjs";

// Chaves dos baldes de classificacao de status HTTP/MQTT. Centralizar
// como constantes evita typos do tipo "5XX" vs "5xx" (acesso silencioso
// undefined) e documenta o conjunto fechado de buckets usados nas
// metricas. As chaves seguem a notacao do RFC HTTP para que CSV/JSON
// gerados continuem legiveis sem dicionario lateral.
const STATUS_BUCKET = Object.freeze({
  INFO:         "1xx",
  OK:           "2xx",
  REDIRECT:     "3xx",
  CLIENT_ERR:   "4xx",
  SERVER_ERR:   "5xx",
  NETWORK_ERR:  "network_error",
  OTHER:        "other",
});

function emptyHttpStatusCounters() {
  return {
    [STATUS_BUCKET.INFO]:        0,
    [STATUS_BUCKET.OK]:          0,
    [STATUS_BUCKET.REDIRECT]:    0,
    [STATUS_BUCKET.CLIENT_ERR]:  0,
    [STATUS_BUCKET.SERVER_ERR]:  0,
    [STATUS_BUCKET.NETWORK_ERR]: 0,
    [STATUS_BUCKET.OTHER]:       0,
  };
}

/**
 * @param {object} args
 * @param {{ name: string, endpoint: string, send: Function, close?: Function }} args.sender
 * @param {string} args.deviceId
 * @param {number} args.intervalMs
 * @param {number} args.durationSec
 * @param {(stats: object) => void} [args.onProgress] - chamada a cada N envios.
 * @param {number} [args.progressEveryN=100]
 * @param {AbortSignal} [args.signal] - cancela o loop antecipadamente.
 * @returns {Promise<object>} resumo final.
 */
export async function runSimulator({
  sender,
  deviceId,
  intervalMs,
  durationSec,
  onProgress,
  progressEveryN = 100,
  signal,
}) {
  if (!sender || typeof sender.send !== "function") {
    throw new Error("runSimulator: sender invalido (sem .send).");
  }
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("runSimulator: intervalMs invalido.");
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("runSimulator: durationSec invalido.");
  }

  const stats = newStats();
  const startedAtPerf = performance.now();
  const startedAtMs = Date.now();
  const endAtPerf = startedAtPerf + durationSec * 1000;
  let nextScheduledPerf = startedAtPerf;
  let seq = 0;

  try {
    while (true) {
      if (signal?.aborted) break;

      const nowPerf = performance.now();
      if (nowPerf >= endAtPerf) break;

      // Se o sender atrasou mais de uma janela inteira, pulamos as
      // perdidas em vez de tentar enviar todas seguidas. Caso contrario
      // a tentativa de "alcancar" a programacao acumularia rajada e
      // mascararia perdas de rede com sobreutilizacao do enlace.
      const sleepFor = nextScheduledPerf - nowPerf;
      if (sleepFor > 0) {
        const cappedSleep = Math.min(sleepFor, Math.max(0, endAtPerf - nowPerf));
        if (cappedSleep > 0) {
          await sleep(cappedSleep);
        }
      } else if (sleepFor < -intervalMs) {
        const skipped = Math.floor(-sleepFor / intervalMs);
        stats.localDrops += skipped;
        nextScheduledPerf += skipped * intervalMs;
      }

      if (signal?.aborted) break;
      if (performance.now() >= endAtPerf) break;

      seq += 1;
      stats.totalAttempts += 1;
      const sendStartedPerf = performance.now();
      const tSeconds = (sendStartedPerf - startedAtPerf) / 1000;
      const payload = buildPayload({
        deviceId,
        seq,
        tSeconds,
        wifiReconnects: 0,
      });

      let result;
      try {
        result = await sender.send(payload);
      } catch (err) {
        result = {
          status: "network_error",
          rttMs: performance.now() - sendStartedPerf,
          error: err?.message ?? String(err),
        };
      }

      recordResult(stats, result);

      if (onProgress && seq % progressEveryN === 0) {
        onProgress({ ...summarize(stats, startedAtMs, intervalMs, durationSec, sender) });
      }

      nextScheduledPerf += intervalMs;
    }
  } finally {
    if (typeof sender.close === "function") {
      try {
        await sender.close();
      } catch {
        /* ignore */
      }
    }
  }

  return summarize(stats, startedAtMs, intervalMs, durationSec, sender);
}

function newStats() {
  return {
    totalAttempts: 0,
    totalAccepted: 0,
    localDrops: 0,
    httpStatus: emptyHttpStatusCounters(),
    rttSamples: [],
    firstErrorSample: null,
  };
}

function bucketForHttpStatus(status) {
  if (status >= 100 && status < 200) return STATUS_BUCKET.INFO;
  if (status >= 200 && status < 300) return STATUS_BUCKET.OK;
  if (status >= 300 && status < 400) return STATUS_BUCKET.REDIRECT;
  if (status >= 400 && status < 500) return STATUS_BUCKET.CLIENT_ERR;
  if (status >= 500 && status < 600) return STATUS_BUCKET.SERVER_ERR;
  return STATUS_BUCKET.OTHER;
}

function rememberFirstError(stats, result) {
  if (!stats.firstErrorSample && result.error) {
    stats.firstErrorSample = result.error;
  }
}

function recordResult(stats, result) {
  if (!result) return;
  if (typeof result.rttMs === "number" && Number.isFinite(result.rttMs)) {
    stats.rttSamples.push(result.rttMs);
  }

  const status = result.status;
  if (typeof status === "number") {
    stats.httpStatus[bucketForHttpStatus(status)] += 1;
    if (status >= 200 && status < 300) stats.totalAccepted += 1;
    return;
  }

  if (status === "ok") {
    // MQTT em QoS 0 nao retorna codigo de status: o publish considera-se
    // bem-sucedido quando entregue ao broker localmente. Reaproveitamos
    // o bucket 2xx para nao quebrar a homogeneidade do schema com A1/A2/A3.
    stats.httpStatus[STATUS_BUCKET.OK] += 1;
    stats.totalAccepted += 1;
    return;
  }

  if (status === "network_error") {
    stats.httpStatus[STATUS_BUCKET.NETWORK_ERR] += 1;
    rememberFirstError(stats, result);
    return;
  }

  stats.httpStatus[STATUS_BUCKET.OTHER] += 1;
  rememberFirstError(stats, result);
}

function summarize(stats, startedAtMs, intervalMs, durationSec, sender) {
  const rtt = stats.rttSamples.slice().sort((a, b) => a - b);
  const len = rtt.length;
  const sum = rtt.reduce((s, v) => s + v, 0);
  const avg = len ? sum / len : null;
  const min = len ? rtt[0] : null;
  const max = len ? rtt[len - 1] : null;
  const p95 = len ? rtt[Math.min(len - 1, Math.floor(0.95 * (len - 1)))] : null;

  return {
    sender: { name: sender.name, endpoint: sender.endpoint },
    intervalMs,
    durationSec,
    startedAtMs,
    stoppedAtMs: Date.now(),
    totalAttempts: stats.totalAttempts,
    totalAccepted: stats.totalAccepted,
    localDrops: stats.localDrops,
    httpStatus: { ...stats.httpStatus },
    rttMs: {
      count: len,
      avg: round3(avg),
      min: round3(min),
      max: round3(max),
      p95: round3(p95),
    },
    firstErrorSample: stats.firstErrorSample,
  };
}

function round3(value) {
  return value == null ? null : Number(value.toFixed(3));
}
