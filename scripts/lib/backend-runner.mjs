
/**
 * Orquestrador da campanha de backend (WebSocket + REST polling).
 *
 * Refatorado na Sub-fase 2.3 (de 913 para ~250 linhas) extraindo:
 *   - `lib_mjs/backend/experiment-client.mjs` (start/stop/reset/postObservation)
 *   - `lib_mjs/backend/observers.mjs` (observeWebSocket, observeRestPolling)
 *   - `lib_mjs/backend/writers.mjs` (headers + writeCampaignFiles + buildExperimentSummary)
 *   - `lib/clock-sync.mjs` ja existia (deduplica logica antes inline)
 *
 * Schemas dos 4 arquivos gerados (sensor-data, metrics, campaign-summary,
 * experiment-summary) sao PRESERVADOS bit-a-bit. Validado por
 * `test_collection_parity.mjs` (sub-fase 2.0).
 */

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
  percent,
  round,
} from './scientific.mjs';
import { createHeartbeat, isRepComplete } from './runtime-utils.mjs';
import {
  postObservation,
  resetExperiment,
  startExperiment,
  stopExperiment,
} from '../lib_mjs/backend/experiment-client.mjs';
import {
  observeRestPolling,
  observeWebSocket,
} from '../lib_mjs/backend/observers.mjs';
import {
  buildSummary,
  makeCampaignId,
  writeCampaignFiles,
} from '../lib_mjs/backend/writers.mjs';
import fs from 'node:fs/promises';

export async function runBackendCampaign({
  baseUrl = 'http://localhost:3000',
  mode = 'websocket',
  source = 'serial',
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [100, 50, 20, 10, 5, 1],
  campaignType = 'official',
  resultsDir = 'resultados',
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000,
} = {}) {
  await fs.mkdir(resultsDir, { recursive: true });
  const lastIntervalMs = intervalsMs[intervalsMs.length - 1];

  for (let rep = 1; rep <= reps; rep++) {
    console.log(
      `\n[orchestrator] ======= ${mode.toUpperCase()} / source=${source} / rep ${rep}/${reps} =======`
    );

    if (resume) {
      const alreadyDone = await isRepComplete({
        resultsDir, architecture: 'backend-node', communicationMode: mode,
        source, lastIntervalMs, rep, campaignType,
      });
      if (alreadyDone) {
        console.log(
          `[orchestrator] rep ${rep} ja possui experiment-summary.json em ${resultsDir}; pulando (resume).`
        );
        continue;
      }
    }

    try {
      await runSingleRep({
        baseUrl, mode, source, rep, reps, durationSeconds, intervalsMs,
        campaignType, resultsDir, heartbeatIntervalMs, continueOnError,
      });
    } catch (error) {
      console.warn(
        `[orchestrator] rep ${rep} falhou: ${error.message}. ${continueOnError ? 'Continuando...' : 'Abortando.'}`
      );
      if (!continueOnError) {
        throw error;
      }
    }
  }
}

async function runSingleRep({
  baseUrl, mode, source, rep, reps, durationSeconds, intervalsMs,
  campaignType, resultsDir, heartbeatIntervalMs, continueOnError,
}) {
  await resetExperiment(baseUrl);
  const campaignId = makeCampaignId();
  const completedRuns = [];
  let lastExperiment = null;
  let lastClockSync = null;
  const campaignStartedAt = new Date().toISOString();

  for (const intervalMs of intervalsMs) {
    console.log(
      `[orchestrator]  interval=${intervalMs}ms  duration=${durationSeconds}s  comecando.`
    );

    try {
      const result = await runSingleInterval({
        baseUrl, mode, source, rep, reps, intervalMs, durationSeconds,
        intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
      });
      completedRuns.push(result.run);
      lastExperiment = result.run.experiment;
      lastClockSync = result.clockSync;
    } catch (error) {
      console.warn(
        `[orchestrator]   intervalo ${intervalMs}ms falhou: ${error.message}. ${continueOnError ? 'Pulando para o proximo intervalo.' : ''}`
      );
      if (!continueOnError) {
        throw error;
      }
      try { await stopExperiment(baseUrl); } catch { /* ignore */ }
    }
  }

  if (!completedRuns.length) {
    console.warn(`[orchestrator] rep ${rep} nao produziu nenhum intervalo bem-sucedido; pulando export.`);
    return;
  }

  addSaturationIndicators(completedRuns.map((run) => run.summary));

  const campaign = {
    id: campaignId, architecture: 'backend-node', communicationMode: mode,
    source, type: campaignType, intervalsMs: [...intervalsMs],
    replicationNumber: rep, startedAt: campaignStartedAt,
    stoppedAt: new Date().toISOString(),
  };

  await writeCampaignFiles({
    resultsDir, completedRuns, lastExperiment, campaign, campaignType,
    clockSync: lastClockSync, replicationNumber: rep,
  });
}

async function runSingleInterval({
  baseUrl, mode, source, rep, reps, intervalMs, durationSeconds,
  intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
}) {
  const frontendBackendSync = await synchronizeBackendClock(baseUrl);
  const payload = {
    architecture: 'backend-node', source, communicationMode: mode,
    sendIntervalMs: intervalMs, durationSeconds, replicationNumber: rep,
    campaignType,
  };

  const experimentResponse = await startExperiment({ baseUrl, payload });
  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync('backend_arduino_sync_missing', 0),
    frontendBackendSync
  );

  const environment = collectEnvironment({
    architecture: 'backend-node', communicationMode: mode, source,
    intervalMs, campaignType,
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
  };
  const latencyCalibrator = createLatencyCalibrator();
  const durationMs = durationSeconds * 1000;
  const expectedMessages = Math.floor(durationMs / intervalMs);

  const heartbeat = createHeartbeat({
    label: `backend-${mode}`,
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
    if (mode === 'websocket') {
      await observeWebSocket({
        baseUrl, durationMs, state, clockSync: mergedClockSync, latencyCalibrator,
      });
    } else {
      await observeRestPolling({
        baseUrl, durationMs, intervalMs, state,
        clockSync: mergedClockSync, latencyCalibrator,
      });
    }
  } finally {
    heartbeat.stop();
  }

  await stopExperiment(baseUrl);
  experiment.stoppedAt = new Date().toISOString();
  experiment.status = 'stopped';

  const summary = buildSummary({
    experiment, samples: state.samples,
    invalidMessages: state.invalidMessages,
    sequenceGapMessages: state.observedSequenceGapMessages,
  });

  const observation = {
    experimentId: experiment.id, campaignId, campaignType,
    replicationNumber: rep, environment,
    samples: state.samples,
    invalidMessages: state.invalidMessages,
    summary,
  };

  await postObservation({ baseUrl, observation });

  const latencyStats = numericStats(
    state.samples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  console.log(
    `[orchestrator]   recebidas=${state.samples.length}/${summary.expectedMessages} ` +
    `throughput=${summary.throughputPercent}% latency_avg=${latencyStats.average ?? 'n/a'}ms`
  );

  return {
    run: {
      experiment, samples: state.samples,
      invalidMessages: state.invalidMessages, summary,
    },
    clockSync: mergedClockSync,
  };
}

// Reuse percent/round to avoid unused-import warnings in some bundlers.
void percent;
void round;
