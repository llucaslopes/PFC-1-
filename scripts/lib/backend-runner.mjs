// Orquestrador das arquiteturas A1 (REST polling), A2 (WebSocket) e A4
// (MQTT via bridge -- a bridge replica o mesmo contrato HTTP/WS do
// backend Node, entao reusamos esse runner). A logica de cada cenario
// vive em lib_mjs/backend/{experiment-client, observers, writers}; aqui
// fica a coreografia: por rep, por intervalo, com warmup, heartbeat e
// gravacao incremental dos arquivos de saida.

import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock,
} from './clock-sync.mjs';
import { freshnessFor, waitForFreshSamples } from './transport-warmup.mjs';
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
  // Hook usado pelo modo --source simulator-http: substitui o ESP32
  // real por um gerador de carga local que sobe/desce a cada intervalo.
  // Sem ESP32 fisico, esse modo permite reproduzir a campanha em CI ou
  // em maquinas sem o hardware.
  intervalLifecycle = null,
  // Identifica a arquitetura nos arquivos de saida. 'backend-node' para
  // A1/A2; 'mqtt' quando esse runner eh apontado para a bridge MQTT.
  architecture = 'backend-node',
} = {}) {
  await fs.mkdir(resultsDir, { recursive: true });
  const lastIntervalMs = intervalsMs[intervalsMs.length - 1];

  for (let rep = 1; rep <= reps; rep++) {
    console.log(
      `\n[orchestrator] ======= ${mode.toUpperCase()} / source=${source} / rep ${rep}/${reps} =======`
    );

    if (resume) {
      const alreadyDone = await isRepComplete({
        resultsDir, architecture, communicationMode: mode,
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
        intervalLifecycle, architecture,
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
  intervalLifecycle, architecture = 'backend-node',
}) {
  await resetExperiment(baseUrl);
  const campaignId = makeCampaignId();
  const completedRuns = [];
  const campaignStartedAt = new Date().toISOString();

  // Gravacao por intervalo (e nao por rep): cada (rep x intervalo) vira
  // um conjunto independente de arquivos. A versao anterior agregava
  // todos os intervalos da rep num unico arquivo, marcado pelo ultimo
  // intervalo -- isso causou perda silenciosa de dados na primeira
  // campanha oficial e dificultava re-execucao individual de intervalos.
  for (const intervalMs of intervalsMs) {
    console.log(
      `[orchestrator]  interval=${intervalMs}ms  duration=${durationSeconds}s  comecando.`
    );

    try {
      const result = await runSingleInterval({
        baseUrl, mode, source, rep, reps, intervalMs, durationSeconds,
        intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
        intervalLifecycle, architecture,
      });
      completedRuns.push(result.run);

      addSaturationIndicators([result.run.summary]);

      const campaign = {
        id: campaignId, architecture, communicationMode: mode,
        source, type: campaignType, intervalsMs: [intervalMs],
        replicationNumber: rep, startedAt: campaignStartedAt,
        stoppedAt: new Date().toISOString(),
      };

      await writeCampaignFiles({
        resultsDir, completedRuns: [result.run], lastExperiment: result.run.experiment,
        campaign, campaignType,
        clockSync: result.clockSync, replicationNumber: rep,
      });
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
    console.warn(`[orchestrator] rep ${rep} nao produziu nenhum intervalo bem-sucedido.`);
    return;
  }
}

async function runSingleInterval({
  baseUrl, mode, source, rep, reps, intervalMs, durationSeconds,
  intervalsMs, campaignType, campaignId, heartbeatIntervalMs,
  intervalLifecycle, architecture = 'backend-node',
}) {
  const frontendBackendSync = await synchronizeBackendClock(baseUrl);
  const payload = {
    architecture, source, communicationMode: mode,
    sendIntervalMs: intervalMs, durationSeconds, replicationNumber: rep,
    campaignType,
  };

  // Warmup do ESP32 real. O sketch dual-active ja esta enviando bem
  // antes do startExperiment ser chamado, e durante a transicao entre
  // cenarios ele leva ate 2 s para detectar o novo backend. Sem essa
  // barreira, o intervalo de transicao seria contabilizado como missing
  // messages e contaminaria as metricas. No modo simulator-http o
  // gerador eh subido sob demanda em beforeObserve, entao o warmup nao
  // se aplica.
  if (source === 'wifi-http') {
    await waitForFreshSamples({
      baseUrl,
      freshnessMs: freshnessFor(intervalMs),
      label: `warmup ${architecture}/${mode} interval=${intervalMs}ms rep=${rep}`,
    });
  }

  const experimentResponse = await startExperiment({ baseUrl, payload });
  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync('backend_arduino_sync_missing', 0),
    frontendBackendSync
  );

  const environment = collectEnvironment({
    architecture, communicationMode: mode, source,
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

  let lifecycleHandle = null;
  if (intervalLifecycle?.beforeObserve) {
    try {
      lifecycleHandle = await intervalLifecycle.beforeObserve({
        intervalMs, durationSeconds, baseUrl, mode, source,
      });
    } catch (err) {
      console.warn(
        `[orchestrator]   intervalLifecycle.beforeObserve falhou: ${err.message}. Seguindo sem ele.`
      );
    }
  }

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
