/**
 * Orquestrador da campanha A3 (Serverless / Vercel Functions).
 *
 * Reaproveita as primitivas do backend-runner (clock-sync.mjs,
 * scientific.mjs, runtime-utils.mjs, writers.mjs), apenas trocando os
 * paths para o prefixo `/api/...` e o `mode` para `serverless-http`.
 *
 * Diferencas conceituais:
 *   - Sem WebSocket: o frontend (e o orquestrador) consultam por REST.
 *   - O ESP32 envia direto para a funcao Vercel (`POST /api/ingest`),
 *     sem passar pelo backend Node.
 *   - Cada interval da campanha pode aproveitar warm starts; o orquestrador
 *     pode forcar cold start opcionalmente esperando N segundos antes
 *     de comecar a coleta.
 */

import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock,
} from './clock-sync.mjs';
import {
  addSaturationIndicators,
  collectEnvironment,
  createLatencyCalibrator,
  environmentToCsv,
  numericStats,
} from './scientific.mjs';
import { createHeartbeat, isRepComplete } from './runtime-utils.mjs';
import {
  postObservation,
  resetExperiment,
  startExperiment,
  stopExperiment,
} from '../lib_mjs/backend/experiment-client.mjs';
import {
  buildSummary,
  makeCampaignId,
  writeCampaignFiles,
} from '../lib_mjs/backend/writers.mjs';

const ARCHITECTURE = 'serverless';
const COMMUNICATION_MODE = 'serverless-http';

// Constroi cliente HTTP com prefixo /api e header opcional X-Api-Key.
function makeHttp(baseUrl, apiKey) {
  const root = baseUrl.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;

  return {
    root,
    headers,
    get(path) {
      return fetch(`${root}${path}`, { headers });
    },
    post(path, body) {
      return fetch(`${root}${path}`, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
  };
}

export async function runServerlessCampaign({
  baseUrl = 'http://localhost:3001',
  apiKey = '',
  source = 'wifi-http',
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [1000, 500, 200, 100, 50, 20],
  campaignType = 'official',
  resultsDir = 'resultados',
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000,
  forceColdStartMs = 0,
} = {}) {
  await fs.mkdir(resultsDir, { recursive: true });
  const lastIntervalMs = intervalsMs[intervalsMs.length - 1];

  for (let rep = 1; rep <= reps; rep++) {
    console.log(
      `\n[orchestrator] ======= SERVERLESS / source=${source} / rep ${rep}/${reps} =======`
    );

    if (resume) {
      const alreadyDone = await isRepComplete({
        resultsDir,
        architecture: ARCHITECTURE,
        communicationMode: COMMUNICATION_MODE,
        source,
        lastIntervalMs,
        rep,
        campaignType,
      });
      if (alreadyDone) {
        console.log(`[orchestrator] rep ${rep} ja completa; pulando (resume).`);
        continue;
      }
    }

    try {
      await runSingleRep({
        baseUrl, apiKey, source, rep, reps, durationSeconds, intervalsMs,
        campaignType, resultsDir, heartbeatIntervalMs, continueOnError,
        forceColdStartMs,
      });
    } catch (error) {
      console.warn(
        `[orchestrator] rep ${rep} falhou: ${error.message}. ${continueOnError ? 'Continuando...' : 'Abortando.'}`
      );
      if (!continueOnError) throw error;
    }
  }
}

async function runSingleRep({
  baseUrl, apiKey, source, rep, reps, durationSeconds, intervalsMs,
  campaignType, resultsDir, heartbeatIntervalMs, continueOnError,
  forceColdStartMs,
}) {
  const http = makeHttp(baseUrl, apiKey);
  await resetExperimentServerless(http);

  const campaignId = makeCampaignId();
  const completedRuns = [];
  let lastExperiment = null;
  let lastClockSync = null;
  const campaignStartedAt = new Date().toISOString();

  for (const intervalMs of intervalsMs) {
    if (forceColdStartMs > 0) {
      console.log(`[orchestrator]   aguardando ${forceColdStartMs}ms para forcar cold start...`);
      await sleep(forceColdStartMs);
    }

    console.log(
      `[orchestrator]  interval=${intervalMs}ms  duration=${durationSeconds}s`
    );

    try {
      const result = await runSingleInterval({
        http, baseUrl, source, rep, reps, intervalMs, durationSeconds,
        intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
      });
      completedRuns.push(result.run);
      lastExperiment = result.run.experiment;
      lastClockSync = result.clockSync;
    } catch (error) {
      console.warn(
        `[orchestrator]   intervalo ${intervalMs}ms falhou: ${error.message}.`
      );
      if (!continueOnError) throw error;
      try { await stopExperimentServerless(http); } catch { /* ignore */ }
    }
  }

  if (!completedRuns.length) {
    console.warn(`[orchestrator] rep ${rep} sem intervalos validos; pulando export.`);
    return;
  }

  addSaturationIndicators(completedRuns.map((run) => run.summary));

  const campaign = {
    id: campaignId,
    architecture: ARCHITECTURE,
    communicationMode: COMMUNICATION_MODE,
    source,
    type: campaignType,
    intervalsMs: [...intervalsMs],
    replicationNumber: rep,
    startedAt: campaignStartedAt,
    stoppedAt: new Date().toISOString(),
  };

  await writeCampaignFiles({
    resultsDir, completedRuns, lastExperiment, campaign, campaignType,
    clockSync: lastClockSync, replicationNumber: rep,
  });
}

async function runSingleInterval({
  http, baseUrl, source, rep, reps, intervalMs, durationSeconds,
  intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
}) {
  // synchronizeBackendClock chama POST /clock/sync. Como o serverless usa
  // /api/clock/sync, montamos um baseUrl efetivo com /api ja embutido.
  const apiBase = `${baseUrl.replace(/\/$/, '')}/api`;
  const frontendBackendSync = await synchronizeBackendClock(apiBase);

  const payload = {
    architecture: ARCHITECTURE,
    source,
    communicationMode: COMMUNICATION_MODE,
    sendIntervalMs: intervalMs,
    durationSeconds,
    replicationNumber: rep,
    campaignType,
  };

  // Configura o intervalo no servidor (ESP32 puxa via /api/config no boot).
  await http.post('/api/config', { intervalMs });
  const startResponse = await http.post('/api/experiments/start', payload);
  const experimentResponse = await startResponse.json();

  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync('serverless_no_arduino_sync', 0),
    frontendBackendSync
  );

  const environment = collectEnvironment({
    architecture: ARCHITECTURE,
    communicationMode: COMMUNICATION_MODE,
    source,
    intervalMs,
    campaignType,
  });

  const experiment = {
    ...experimentResponse,
    clockSync: mergedClockSync,
    environment,
    environmentText: environmentToCsv(environment),
    replicationNumber: rep,
    campaignType,
  };

  const state = {
    startedAtIso: experiment.startedAt,
    samples: [],
    invalidMessages: [],
    lastObservedSeq: null,
    observedSequenceGapMessages: 0,
    httpStatus: { '2xx': 0, '4xx': 0, '5xx': 0 },
  };
  const latencyCalibrator = createLatencyCalibrator();
  const durationMs = durationSeconds * 1000;
  const expectedMessages = Math.floor(durationMs / intervalMs);

  const heartbeat = createHeartbeat({
    label: 'serverless',
    intervalMs: heartbeatIntervalMs,
    getStatus: () => ({
      rep: `${rep}/${reps}`,
      intervalIdx: `${intervalsMs.indexOf(intervalMs) + 1}/${intervalsMs.length}`,
      intervalMs: `${intervalMs}ms`,
      received: state.samples.length,
      expected: expectedMessages,
    }),
  });

  heartbeat.start();
  try {
    await observeServerless({ http, durationMs, intervalMs, state, clockSync: mergedClockSync, latencyCalibrator });
  } finally {
    heartbeat.stop();
  }

  await stopExperimentServerless(http);
  experiment.stoppedAt = new Date().toISOString();
  experiment.status = 'stopped';

  const summary = buildSummary({
    experiment,
    samples: state.samples,
    invalidMessages: state.invalidMessages,
    sequenceGapMessages: state.observedSequenceGapMessages,
  });
  summary.httpStatusDistribution = state.httpStatus;

  const observation = {
    experimentId: experiment.id,
    campaignId,
    campaignType,
    replicationNumber: rep,
    environment,
    samples: state.samples,
    invalidMessages: state.invalidMessages,
    summary,
  };
  await http.post('/api/experiments/observations', observation);

  const latencyStats = numericStats(
    state.samples.map((s) => s.endToEndLatencyMs ?? s.estimatedEndToEndLatencyMs)
  );
  console.log(
    `[orchestrator]   recebidas=${state.samples.length}/${summary.expectedMessages} ` +
    `throughput=${summary.throughputPercent}% latency_avg=${latencyStats.average ?? 'n/a'}ms`
  );

  return {
    run: { experiment, samples: state.samples, invalidMessages: state.invalidMessages, summary },
    clockSync: mergedClockSync,
  };
}

// Polling do /api/data/latest com deduplicacao por seq, mesma logica do
// observeRestPolling, mas adaptada ao prefixo /api e sem dependencia de
// sensorMessage canonico (montamos a partir do StoredSample).
async function observeServerless({ http, durationMs, intervalMs, state, clockSync, latencyCalibrator }) {
  const pollIntervalMs = Math.max(5, Math.min(50, Math.floor(intervalMs / 4)));
  const deadline = Date.now() + durationMs;

  while (Date.now() < deadline) {
    let response;
    try {
      response = await http.get(`/api/data/latest?deviceId=esp32-01`);
    } catch (error) {
      state.invalidMessages.push({ receivedAt: new Date().toISOString(), rawLine: `network_error:${error.message}` });
      state.httpStatus['5xx'] += 1;
      await sleep(pollIntervalMs);
      continue;
    }

    if (!response.ok) {
      const bucket = response.status >= 500 ? '5xx' : response.status >= 400 ? '4xx' : '2xx';
      state.httpStatus[bucket] += 1;
      await sleep(pollIntervalMs);
      continue;
    }
    state.httpStatus['2xx'] += 1;

    const sample = await response.json().catch(() => null);
    if (!sample || typeof sample.seq !== 'number') {
      await sleep(pollIntervalMs);
      continue;
    }

    if (state.lastObservedSeq !== null && sample.seq <= state.lastObservedSeq) {
      await sleep(pollIntervalMs);
      continue;
    }

    if (state.lastObservedSeq !== null && sample.seq > state.lastObservedSeq + 1) {
      state.observedSequenceGapMessages += sample.seq - state.lastObservedSeq - 1;
    }
    state.lastObservedSeq = sample.seq;

    const frontendReceiveMs = Date.now();
    const sendUs = Number(sample.sendUs);
    const sendMs = sendUs / 1000;
    const offsetMs = clockSync?.frontendBackendOffsetMs ?? 0;
    const estimatedFrontendSendMs = sendMs + offsetMs;
    const endToEndLatencyMs = frontendReceiveMs - estimatedFrontendSendMs;
    latencyCalibrator?.observe?.(endToEndLatencyMs);

    state.samples.push({
      receivedAt: new Date(frontendReceiveMs).toISOString(),
      frontendReceiveMs,
      receiveMs: frontendReceiveMs,
      seq: sample.seq,
      sendUs,
      sendMs,
      hr: sample.hr,
      ax: sample.ax,
      ay: sample.ay,
      az: sample.az,
      accelerationMagnitude: sample.magnitude,
      estimatedFrontendSendMs,
      endToEndLatencyMs,
      estimatedEndToEndLatencyMs: endToEndLatencyMs,
      relativeEstimatedLatencyMs: endToEndLatencyMs,
      clockOffsetMs: offsetMs,
      clockSyncOffsetMs: offsetMs,
      clockUncertaintyMs: clockSync?.frontendBackendUncertaintyMs ?? null,
      clockSyncUncertaintyMs: clockSync?.frontendBackendUncertaintyMs ?? null,
      syncRttMs: clockSync?.frontendBackendRttMs ?? null,
      latencyMethod: 'serverless_http_poll',
      localProcessingLatencyMs: sample.serverlessProcessingLatencyMs ?? 0,
      coldStartMs: sample.coldStartMs ?? null,
      wifiRssiDbm: sample.wifiRssiDbm ?? null,
      wifiReconnects: sample.wifiReconnects ?? null,
      deviceId: sample.deviceId ?? null,
    });

    await sleep(pollIntervalMs);
  }
}

async function resetExperimentServerless(http) {
  await http.post('/api/experiments/reset', {});
}

async function stopExperimentServerless(http) {
  await http.post('/api/experiments/stop', {});
}

void resetExperiment;
void startExperiment;
void stopExperiment;
void postObservation;
