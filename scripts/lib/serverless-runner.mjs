// Orquestrador da arquitetura A3 (Serverless / Vercel Functions),
// considerada complementar no estudo. Compartilha primitivas com o
// backend-runner (clock-sync, writers, observers), trocando o caminho
// das rotas para o prefixo `/api/...` e adaptando a coleta para HTTP
// puro (sem WebSocket).
//
// O parametro forceColdStartMs permite injetar um sleep antes da
// observacao para invalidar o warm start do runtime serverless. Sem
// isso, somente o primeiro intervalo da campanha mediria cold start;
// os demais estariam viesados para baixo. Em troca, eleva o tempo
// total da rodada e nao deve ser usado durante a campanha oficial.

import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock,
} from './clock-sync.mjs';
import {
  freshnessFor,
  waitForFreshSamplesServerless,
} from './transport-warmup.mjs';
import {
  addSaturationIndicators,
  collectEnvironment,
  createLatencyCalibrator,
  environmentToCsv,
  numericStats,
} from './scientific.mjs';
import { createHeartbeat, isRepComplete } from './runtime-utils.mjs';
import {
  buildSummary,
  makeCampaignId,
  writeCampaignFiles,
} from '../lib_mjs/backend/writers.mjs';

const ARCHITECTURE = 'serverless';
const COMMUNICATION_MODE = 'serverless-http';

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
  intervalLifecycle = null,
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
        forceColdStartMs, intervalLifecycle,
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
  forceColdStartMs, intervalLifecycle,
}) {
  const http = makeHttp(baseUrl, apiKey);
  await resetExperimentServerless(http);

  const campaignId = makeCampaignId();
  const completedRuns = [];
  const campaignStartedAt = new Date().toISOString();

  // Mesma estrategia do backend-runner: um arquivo por (rep, intervalo).
  // Ver comentario la para o motivo (perda silenciosa na campanha v1).
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
        intervalLifecycle,
      });
      completedRuns.push(result.run);

      addSaturationIndicators([result.run.summary]);

      const campaign = {
        id: campaignId,
        architecture: ARCHITECTURE,
        communicationMode: COMMUNICATION_MODE,
        source,
        type: campaignType,
        intervalsMs: [intervalMs],
        replicationNumber: rep,
        startedAt: campaignStartedAt,
        stoppedAt: new Date().toISOString(),
      };

      await writeCampaignFiles({
        resultsDir, completedRuns: [result.run], lastExperiment: result.run.experiment,
        campaign, campaignType,
        clockSync: result.clockSync, replicationNumber: rep,
      });
    } catch (error) {
      console.warn(
        `[orchestrator]   intervalo ${intervalMs}ms falhou: ${error.message}.`
      );
      if (!continueOnError) throw error;
      try { await stopExperimentServerless(http); } catch { /* ignore */ }
    }
  }

  if (!completedRuns.length) {
    console.warn(`[orchestrator] rep ${rep} sem intervalos validos.`);
    return;
  }
}

async function runSingleInterval({
  http, baseUrl, source, rep, reps, intervalMs, durationSeconds,
  intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
  intervalLifecycle,
}) {
  // synchronizeBackendClock assume que o endpoint de sync esta em
  // /clock/sync. Como o runtime serverless serve sob /api, montamos um
  // baseUrl efetivo com esse prefixo ja embutido.
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

  // Atualiza o intervalo vigente para que o ESP32 (ou simulador) puxe
  // o novo valor via GET /api/config no proximo poll.
  await http.post('/api/config', { intervalMs });

  // Mesmo motivo do warmup do backend-runner: barreira para nao
  // contabilizar a janela de transicao dual-active como missingMessages.
  if (source === 'wifi-http') {
    await waitForFreshSamplesServerless({
      baseUrl: apiBase,
      apiKey: http.headers['x-api-key'] ?? '',
      freshnessMs: freshnessFor(intervalMs),
      label: `warmup serverless interval=${intervalMs}ms rep=${rep}`,
    });
  }

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

  let lifecycleHandle = null;
  if (intervalLifecycle?.beforeObserve) {
    try {
      lifecycleHandle = await intervalLifecycle.beforeObserve({
        intervalMs, durationSeconds, baseUrl, mode: COMMUNICATION_MODE, source,
      });
    } catch (err) {
      console.warn(
        `[orchestrator]   intervalLifecycle.beforeObserve falhou: ${err.message}. Seguindo sem ele.`
      );
    }
  }

  heartbeat.start();
  try {
    await observeServerless({ http, durationMs, intervalMs, state, clockSync: mergedClockSync, latencyCalibrator });
  } finally {
    heartbeat.stop();
    if (intervalLifecycle?.afterObserve && lifecycleHandle) {
      try {
        await intervalLifecycle.afterObserve(lifecycleHandle);
      } catch (err) {
        console.warn(
          `[orchestrator]   intervalLifecycle.afterObserve falhou: ${err.message}. Ignorando.`
        );
      }
    }
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

// Equivalente do observeRestPolling para a A3. Le /api/data/latest e
// desduplica por seq -- a funcao serverless nao mantem stream, entao
// nao da para reaproveitar o observador WebSocket. A escolha de poll
// rapido (1/4 do intervalo de envio) busca registrar cada amostra
// proximo de quando ela chega, sem martelar a funcao a ponto de gerar
// invocacoes que nao correspondem a amostras novas.
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

    // Calculo de latencia end-to-end:
    //   frontendReceiveMs = Date.now() (epoch ms do orquestrador)
    //   sendMs            = send_us/1000 (epoch ms do ESP32 via SNTP)
    //
    // Ambos estao na mesma escala (epoch absoluto), entao NAO se aplica
    // o offset de Cristian -- ele esta em escala performance.now(),
    // relativa ao boot do processo, e somar misturava as duas escalas
    // (foi a causa das latencias de -247 s na campanha preliminar).
    //
    // O drift NTP residual entre PC e ESP32 (tipicamente sub-100 ms em
    // LAN local) fica registrado como clockUncertaintyMs no schema, e
    // estabelece a margem de incerteza das medidas de latencia.
    const frontendReceiveMs = Date.now();
    const sendUs = Number(sample.sendUs);
    const sendMs = sendUs / 1000;
    const offsetMs = clockSync?.frontendBackendOffsetMs ?? 0;
    const estimatedFrontendSendMs = sendMs;
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
