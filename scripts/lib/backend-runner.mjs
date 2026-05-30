import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { WebSocket } from "ws";
import {
  computeCristianSync,
  computeEndToEndLatency,
  remoteSendToHostMs
} from "./clockSyncMath.mjs";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  collectEnvironment,
  createDownloadFilename,
  createExperimentExportBlock,
  createLatencyCalibrator,
  createRawRows,
  createRunSummary,
  createSaturationAnalysis,
  createSummaryRow,
  environmentToCsv,
  numericStats,
  percent,
  round
} from "./scientific.mjs";
import { createHeartbeat, isRepComplete } from "./runtime-utils.mjs";

const CLOCK_SYNC_ATTEMPTS = 10;
const LATENCY_METHOD_SYNC = "ntp_style_clock_synchronization";
const LATENCY_METHOD_FALLBACK = "relative_offset_between_arduino_millis_and_frontend_performance_now";

function createRelativeFallbackClockSync(reason = "sync_not_available", attempts = 0) {
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
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

async function synchronizeBackendClock(baseUrl, attempts = CLOCK_SYNC_ATTEMPTS) {
  const samples = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const t0 = performance.now();
      const response = await fetch(`${baseUrl}/clock/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ clientT0: t0 })
      });
      const payload = await response.json();
      const t3 = performance.now();
      const backendT1Ms = Number(payload.backendT1Ms);
      const backendT2Ms = Number(payload.backendT2Ms);

      if (!response.ok || !Number.isFinite(backendT1Ms) || !Number.isFinite(backendT2Ms)) {
        continue;
      }

      samples.push({
        t0,
        t3,
        ...computeCristianSync({ t0, t1: backendT1Ms, t2: backendT2Ms, t3, remoteUnit: "ms" })
      });
      await sleep(20);
    } catch {
      await sleep(20);
    }
  }

  if (!samples.length) {
    return createRelativeFallbackClockSync("backend_clock_sync_failed", attempts);
  }

  const selected = samples.sort((a, b) => a.roundTripMs - b.roundTripMs)[0];
  return {
    arduinoToBackendOffsetMs: null,
    arduinoToBackendRttMs: null,
    arduinoToBackendUncertaintyMs: null,
    arduinoHostOffsetMs: null,
    arduinoHostRttMs: null,
    arduinoHostUncertaintyMs: null,
    backendToFrontendOffsetMs: selected.offsetMs,
    backendToFrontendRttMs: selected.roundTripMs,
    backendToFrontendUncertaintyMs: selected.uncertaintyMs,
    frontendBackendOffsetMs: selected.offsetMs,
    frontendBackendRttMs: selected.roundTripMs,
    frontendBackendUncertaintyMs: selected.uncertaintyMs,
    syncAttempts: attempts,
    selectedBy: "lowest_rtt",
    syncedAt: new Date().toISOString(),
    syncFailed: false
  };
}

function mergeClockSync(backendArduinoSync, frontendBackendSync) {
  const backendFailed = backendArduinoSync?.syncFailed ?? true;
  const frontendFailed = frontendBackendSync?.syncFailed ?? true;
  const arduinoToBackendOffsetMs =
    backendArduinoSync?.arduinoToBackendOffsetMs ?? backendArduinoSync?.arduinoHostOffsetMs ?? null;
  const arduinoToBackendUncertaintyMs =
    backendArduinoSync?.arduinoToBackendUncertaintyMs ??
    backendArduinoSync?.arduinoHostUncertaintyMs ??
    null;
  const backendToFrontendOffsetMs =
    frontendBackendSync?.backendToFrontendOffsetMs ??
    frontendBackendSync?.frontendBackendOffsetMs ??
    null;
  const backendToFrontendUncertaintyMs =
    frontendBackendSync?.backendToFrontendUncertaintyMs ??
    frontendBackendSync?.frontendBackendUncertaintyMs ??
    null;
  const arduinoToFrontendOffsetMs =
    Number.isFinite(arduinoToBackendOffsetMs) && Number.isFinite(backendToFrontendOffsetMs)
      ? arduinoToBackendOffsetMs + backendToFrontendOffsetMs
      : null;
  const totalUncertaintyMs =
    Number.isFinite(arduinoToBackendUncertaintyMs) && Number.isFinite(backendToFrontendUncertaintyMs)
      ? arduinoToBackendUncertaintyMs + backendToFrontendUncertaintyMs
      : null;

  return {
    arduinoToBackendOffsetMs,
    arduinoToBackendRttMs:
      backendArduinoSync?.arduinoToBackendRttMs ?? backendArduinoSync?.arduinoHostRttMs ?? null,
    arduinoToBackendUncertaintyMs,
    arduinoHostOffsetMs: arduinoToBackendOffsetMs,
    arduinoHostRttMs:
      backendArduinoSync?.arduinoToBackendRttMs ?? backendArduinoSync?.arduinoHostRttMs ?? null,
    arduinoHostUncertaintyMs: arduinoToBackendUncertaintyMs,
    backendToFrontendOffsetMs,
    backendToFrontendRttMs:
      frontendBackendSync?.backendToFrontendRttMs ?? frontendBackendSync?.frontendBackendRttMs ?? null,
    backendToFrontendUncertaintyMs,
    frontendBackendOffsetMs: backendToFrontendOffsetMs,
    frontendBackendRttMs:
      frontendBackendSync?.backendToFrontendRttMs ?? frontendBackendSync?.frontendBackendRttMs ?? null,
    frontendBackendUncertaintyMs: backendToFrontendUncertaintyMs,
    arduinoToFrontendOffsetMs,
    arduinoToFrontendUncertaintyMs: totalUncertaintyMs,
    arduinoRemoteUnit: backendArduinoSync?.arduinoRemoteUnit ?? null,
    syncAttempts: Math.max(
      backendArduinoSync?.syncAttempts ?? 0,
      frontendBackendSync?.syncAttempts ?? 0
    ),
    selectedBy: "lowest_rtt",
    syncedAt: frontendBackendSync?.syncedAt ?? backendArduinoSync?.syncedAt ?? null,
    syncFailed: backendFailed || frontendFailed,
    fallbackReason:
      backendFailed || frontendFailed
        ? [backendArduinoSync?.fallbackReason, frontendBackendSync?.fallbackReason]
            .filter(Boolean)
            .join("; ") || "sync_failed"
        : undefined
  };
}

function toWsUrl(httpUrl) {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function recordObservedMessage({ message, state, clockSync, latencyCalibrator }) {
  const sensor = message.sensor;

  if (Date.parse(message.receivedAt) < Date.parse(state.startedAtIso)) {
    return;
  }

  const receiveMs = performance.now();
  const seq = sensor.id;

  if (state.lastObservedSeq !== null && seq > state.lastObservedSeq + 1) {
    state.observedSequenceGapMessages += seq - state.lastObservedSeq - 1;
  }
  state.lastObservedSeq = seq;

  const sendUs = message.arduinoSendUs ?? Math.round(sensor.sendUs ?? sensor.timestamp * 1000);
  const sendMs = sensor.timestamp;
  const relativeEstimatedLatencyMs = latencyCalibrator.calculate(sendMs, receiveMs);
  const backendToFrontendOffsetMs =
    clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs;
  const hasSynchronizedClock =
    clockSync &&
    !clockSync.syncFailed &&
    Number.isFinite(message.estimatedBackendSendTimeMs) &&
    Number.isFinite(backendToFrontendOffsetMs);
  const estimatedFrontendSendMs = hasSynchronizedClock
    ? remoteSendToHostMs(message.estimatedBackendSendTimeMs, "ms", backendToFrontendOffsetMs)
    : null;
  const endToEndLatencyMs = hasSynchronizedClock
    ? computeEndToEndLatency(receiveMs, message.estimatedBackendSendTimeMs, "ms", backendToFrontendOffsetMs)
    : relativeEstimatedLatencyMs;
  const latencyMethod = hasSynchronizedClock ? LATENCY_METHOD_SYNC : LATENCY_METHOD_FALLBACK;
  const clockUncertaintyMs = hasSynchronizedClock
    ? (message.backendArduinoClockUncertaintyMs ?? 0) +
      (clockSync.backendToFrontendUncertaintyMs ?? clockSync.frontendBackendUncertaintyMs ?? 0)
    : null;
  const syncRttMs = hasSynchronizedClock
    ? clockSync.backendToFrontendRttMs ?? clockSync.frontendBackendRttMs ?? null
    : null;

  state.samples.push({
    receivedAt: new Date().toISOString(),
    frontendReceiveMs: receiveMs,
    receiveMs,
    seq,
    sendUs,
    sendMs,
    hr: sensor.heartRate,
    ax: sensor.acceleration.x,
    ay: sensor.acceleration.y,
    az: sensor.acceleration.z,
    accelerationMagnitude: sensor.acceleration.magnitude,
    estimatedFrontendSendMs,
    endToEndLatencyMs,
    estimatedEndToEndLatencyMs: endToEndLatencyMs,
    relativeEstimatedLatencyMs,
    clockOffsetMs: hasSynchronizedClock ? backendToFrontendOffsetMs : null,
    clockSyncOffsetMs: hasSynchronizedClock ? backendToFrontendOffsetMs : null,
    clockUncertaintyMs,
    clockSyncUncertaintyMs: clockUncertaintyMs,
    syncRttMs,
    latencyMethod,
    localProcessingLatencyMs: 0
  });
}

async function observeWebSocket({ baseUrl, durationMs, state, clockSync, latencyCalibrator }) {
  return new Promise((resolveObserve, rejectObserve) => {
    const socket = new WebSocket(toWsUrl(baseUrl));
    let stopTimer = null;
    let resolved = false;

    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (stopTimer) clearTimeout(stopTimer);
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
      resolveObserve();
    };

    socket.on("open", () => {
      stopTimer = setTimeout(finish, durationMs);
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(String(data));
        if (payload.type === "sensor-data") {
          recordObservedMessage({
            message: payload.data,
            state,
            clockSync,
            latencyCalibrator
          });
        }
      } catch (error) {
        console.warn(`[orchestrator] WS payload invalido: ${error.message}`);
      }
    });

    socket.on("error", (error) => {
      if (!resolved) {
        resolved = true;
        if (stopTimer) clearTimeout(stopTimer);
        rejectObserve(error);
      }
    });

    socket.on("close", () => {
      finish();
    });
  });
}

async function observeRestPolling({
  baseUrl,
  durationMs,
  intervalMs,
  state,
  clockSync,
  latencyCalibrator
}) {
  const seen = new Set();
  const deadline = Date.now() + durationMs;
  let running = true;

  async function poll() {
    if (!running) return;
    try {
      const response = await fetch(`${baseUrl}/data/latest`, { cache: "no-store" });
      if (!response.ok) return;
      const message = await response.json();
      const seq = message?.sensor?.id;
      if (seq == null || seen.has(seq)) return;
      seen.add(seq);
      recordObservedMessage({ message, state, clockSync, latencyCalibrator });
    } catch {
      // transient error
    }
  }

  return new Promise((resolveObserve) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline) {
        running = false;
        clearInterval(timer);
        resolveObserve();
        return;
      }
      poll();
    }, intervalMs);
  });
}

function buildSummary({ experiment, samples, invalidMessages, sequenceGapMessages }) {
  return createRunSummary({
    experiment,
    samples,
    invalidMessages,
    sequenceGapMessages
  });
}

function createCampaignSummaryHeader() {
  return [
    "experiment_id",
    "architecture",
    "communication_mode",
    "source",
    "started_at",
    "stopped_at",
    "interval_ms",
    "duration_seconds",
    "expected_messages",
    "received_messages",
    "missing_messages",
    "sequence_gap_messages",
    "throughput_percent",
    "messages_per_second",
    "estimated_latency_avg_ms",
    "estimated_latency_min_ms",
    "estimated_latency_max_ms",
    "estimated_latency_std_ms",
    "estimated_latency_p95_ms",
    "uncertainty_avg_ms",
    "uncertainty_p95_ms",
    "uncertainty_max_ms",
    "invalid_messages",
    "application_version",
    "replication_number",
    "environment",
    "saturation_indicators",
    "saturation_status"
  ];
}

function createSensorDataHeader() {
  return [
    "experiment_id",
    "architecture",
    "communication_mode",
    "source",
    "interval_ms",
    "seq",
    "send_us",
    "frontend_receive_ms",
    "estimated_frontend_send_ms",
    "end_to_end_latency_ms",
    "clock_offset_ms",
    "clock_uncertainty_ms",
    "sync_rtt_ms",
    "latency_method",
    "hr",
    "ax",
    "ay",
    "az"
  ];
}

function buildExperimentSummary({ runs, lastExperiment, campaign, clockSync }) {
  const annotated = addSaturationIndicators([...runs]);
  const primarySummary = annotated[annotated.length - 1] ?? null;
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(annotated);

  return {
    ...(exportBlock ?? {}),
    campaign: campaign
      ? {
          ...campaign,
          applicationVersion: SCIENTIFIC_CONFIG.applicationVersion
        }
      : null,
    runs: annotated,
    saturationAnalysis,
    saturation,
    architecture: lastExperiment.architecture,
    communicationMode: lastExperiment.communicationMode,
    source: lastExperiment.source,
    intervalMs: lastExperiment.sendIntervalMs,
    durationSeconds: lastExperiment.durationSeconds,
    startedAt: lastExperiment.startedAt,
    stoppedAt: lastExperiment.stoppedAt,
    replicationNumber: lastExperiment.replicationNumber,
    environment: lastExperiment.environment ?? null,
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: clockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: clockSync ?? null,
    estimatedLatencyMs: {
      samples: primarySummary?.estimatedLatencySamples ?? 0,
      average: primarySummary?.estimatedLatencyAverageMs ?? null,
      min: primarySummary?.estimatedLatencyMinMs ?? null,
      max: primarySummary?.estimatedLatencyMaxMs ?? null,
      standardDeviation: primarySummary?.estimatedLatencyStdDevMs ?? null,
      p95: primarySummary?.estimatedLatencyP95Ms ?? null
    },
    saturationIndicators: primarySummary?.saturationIndicators ?? [],
    saturationIndicatorCodes: primarySummary?.saturationIndicatorCodes ?? [],
    methodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    experiment: lastExperiment,
    scientificSummary: annotated.length === 1 ? annotated[0] : annotated,
    interpretation: {
      processingTimeNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${primarySummary?.messagesPerSecond ?? 0} mensagens/s`,
      realTimeAdequacy:
        lastExperiment.communicationMode === "websocket"
          ? "WebSocket tende a ser mais adequado para tempo real por entregar eventos por push."
          : "REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes."
    }
  };
}

async function postObservation({ baseUrl, observation }) {
  try {
    await fetch(`${baseUrl}/experiments/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(observation)
    });
  } catch (error) {
    console.warn(`[orchestrator] Falha ao postar observacao: ${error.message}`);
  }
}

async function startExperiment({ baseUrl, payload }) {
  const response = await fetch(`${baseUrl}/experiments/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`POST /experiments/start falhou: HTTP ${response.status}`);
  }
  return response.json();
}

async function stopExperiment(baseUrl) {
  await fetch(`${baseUrl}/experiments/stop`, { method: "POST" });
}

async function resetExperiment(baseUrl) {
  await fetch(`${baseUrl}/experiments/reset`, { method: "POST" });
}

function makeCampaignId() {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export async function runBackendCampaign({
  baseUrl = "http://localhost:3000",
  mode = "websocket",
  source = "serial",
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [100, 50, 20, 10, 5, 1],
  resultsDir = "resultados",
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000
} = {}) {
  await fs.mkdir(resultsDir, { recursive: true });
  const lastIntervalMs = intervalsMs[intervalsMs.length - 1];

  for (let rep = 1; rep <= reps; rep++) {
    console.log(
      `\n[orchestrator] ======= ${mode.toUpperCase()} / source=${source} / rep ${rep}/${reps} =======`
    );

    if (resume) {
      const alreadyDone = await isRepComplete({
        resultsDir,
        architecture: "backend-node",
        communicationMode: mode,
        source,
        lastIntervalMs,
        rep
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
        baseUrl,
        mode,
        source,
        rep,
        reps,
        durationSeconds,
        intervalsMs,
        resultsDir,
        heartbeatIntervalMs,
        continueOnError
      });
    } catch (error) {
      console.warn(
        `[orchestrator] rep ${rep} falhou: ${error.message}. ${continueOnError ? "Continuando..." : "Abortando."}`
      );
      if (!continueOnError) {
        throw error;
      }
    }
  }
}

async function runSingleRep({
  baseUrl,
  mode,
  source,
  rep,
  reps,
  durationSeconds,
  intervalsMs,
  resultsDir,
  heartbeatIntervalMs,
  continueOnError
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
        baseUrl,
        mode,
        source,
        rep,
        reps,
        intervalMs,
        durationSeconds,
        intervalsMs,
        campaignId,
        heartbeatIntervalMs
      });
      completedRuns.push(result.run);
      lastExperiment = result.run.experiment;
      lastClockSync = result.clockSync;
    } catch (error) {
      console.warn(
        `[orchestrator]   intervalo ${intervalMs}ms falhou: ${error.message}. ${continueOnError ? "Pulando para o proximo intervalo." : ""}`
      );
      if (!continueOnError) {
        throw error;
      }
      try {
        await stopExperiment(baseUrl);
      } catch {
        // ignore
      }
    }
  }

  if (!completedRuns.length) {
    console.warn(`[orchestrator] rep ${rep} nao produziu nenhum intervalo bem-sucedido; pulando export.`);
    return;
  }

  addSaturationIndicators(completedRuns.map((run) => run.summary));

  const campaign = {
    id: campaignId,
    architecture: "backend-node",
    communicationMode: mode,
    source,
    intervalsMs: [...intervalsMs],
    replicationNumber: rep,
    startedAt: campaignStartedAt,
    stoppedAt: new Date().toISOString()
  };

  await writeCampaignFiles({
    resultsDir,
    completedRuns,
    lastExperiment,
    campaign,
    clockSync: lastClockSync,
    replicationNumber: rep
  });
}

async function runSingleInterval({
  baseUrl,
  mode,
  source,
  rep,
  reps,
  intervalMs,
  durationSeconds,
  intervalsMs,
  campaignId,
  heartbeatIntervalMs
}) {
  const frontendBackendSync = await synchronizeBackendClock(baseUrl);
  const payload = {
    architecture: "backend-node",
    source,
    communicationMode: mode,
    sendIntervalMs: intervalMs,
    durationSeconds,
    replicationNumber: rep
  };

  const experimentResponse = await startExperiment({ baseUrl, payload });
  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync("backend_arduino_sync_missing", 0),
    frontendBackendSync
  );

  const environment = collectEnvironment({
    architecture: "backend-node",
    communicationMode: mode,
    source,
    intervalMs
  });

  const experiment = {
    ...experimentResponse,
    clockSync: mergedClockSync,
    environment,
    environmentText: environmentToCsv(environment),
    replicationNumber: rep
  };

  const state = {
    startedAtIso: experiment.startedAt,
    samples: [],
    invalidMessages: [],
    lastObservedSeq: null,
    observedSequenceGapMessages: 0
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
      expected: expectedMessages
    })
  });

  heartbeat.start();
  try {
    if (mode === "websocket") {
      await observeWebSocket({
        baseUrl,
        durationMs,
        state,
        clockSync: mergedClockSync,
        latencyCalibrator
      });
    } else {
      await observeRestPolling({
        baseUrl,
        durationMs,
        intervalMs,
        state,
        clockSync: mergedClockSync,
        latencyCalibrator
      });
    }
  } finally {
    heartbeat.stop();
  }

  await stopExperiment(baseUrl);
  experiment.stoppedAt = new Date().toISOString();
  experiment.status = "stopped";

  const summary = buildSummary({
    experiment,
    samples: state.samples,
    invalidMessages: state.invalidMessages,
    sequenceGapMessages: state.observedSequenceGapMessages
  });

  const observation = {
    experimentId: experiment.id,
    campaignId,
    replicationNumber: rep,
    environment,
    samples: state.samples,
    invalidMessages: state.invalidMessages,
    summary
  };

  await postObservation({ baseUrl, observation });

  const latencyStats = numericStats(
    state.samples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  console.log(
    `[orchestrator]   recebidas=${state.samples.length}/${summary.expectedMessages} throughput=${summary.throughputPercent}% latency_avg=${latencyStats.average ?? "n/a"}ms`
  );

  return {
    run: {
      experiment,
      samples: state.samples,
      invalidMessages: state.invalidMessages,
      summary
    },
    clockSync: mergedClockSync
  };
}

async function writeCampaignFiles({
  resultsDir,
  completedRuns,
  lastExperiment,
  campaign,
  clockSync,
  replicationNumber
}) {
  const sensorRows = [createSensorDataHeader()];
  for (const run of completedRuns) {
    sensorRows.push(...createRawRows(run.experiment, run.samples));
  }

  const summaries = completedRuns.map((run) => run.summary);
  const annotatedSummaries = addSaturationIndicators(summaries);
  const metricsRows = [createCampaignSummaryHeader(), ...annotatedSummaries.map(createSummaryRow)];

  const sensorCsv = toCsv(sensorRows);
  const metricsCsv = toCsv(metricsRows);
  const campaignSummaryCsv = toCsv([
    createCampaignSummaryHeader(),
    ...annotatedSummaries.map(createSummaryRow)
  ]);
  const summaryJson = JSON.stringify(
    buildExperimentSummary({
      runs: annotatedSummaries,
      lastExperiment,
      campaign,
      clockSync
    }),
    null,
    2
  );

  const baseFilename = createDownloadFilename(
    {
      architecture: lastExperiment.architecture,
      communicationMode: lastExperiment.communicationMode,
      source: lastExperiment.source,
      sendIntervalMs: lastExperiment.sendIntervalMs
    },
    "sensor-data",
    "csv",
    replicationNumber
  );

  await fs.writeFile(path.join(resultsDir, baseFilename), sensorCsv, "utf8");
  await fs.writeFile(
    path.join(
      resultsDir,
      createDownloadFilename(
        {
          architecture: lastExperiment.architecture,
          communicationMode: lastExperiment.communicationMode,
          source: lastExperiment.source,
          sendIntervalMs: lastExperiment.sendIntervalMs
        },
        "metrics",
        "csv",
        replicationNumber
      )
    ),
    metricsCsv,
    "utf8"
  );
  await fs.writeFile(
    path.join(
      resultsDir,
      createDownloadFilename(
        {
          architecture: lastExperiment.architecture,
          communicationMode: lastExperiment.communicationMode,
          source: lastExperiment.source,
          sendIntervalMs: lastExperiment.sendIntervalMs
        },
        "campaign-summary",
        "csv",
        replicationNumber
      )
    ),
    campaignSummaryCsv,
    "utf8"
  );
  await fs.writeFile(
    path.join(
      resultsDir,
      createDownloadFilename(
        {
          architecture: lastExperiment.architecture,
          communicationMode: lastExperiment.communicationMode,
          source: lastExperiment.source,
          sendIntervalMs: lastExperiment.sendIntervalMs
        },
        "experiment-summary",
        "json",
        replicationNumber
      )
    ),
    summaryJson,
    "utf8"
  );

  console.log(`[orchestrator] Arquivos da rep gravados em ${resultsDir}/.`);
}

// Reuse percent/round to avoid unused-import warnings in some bundlers.
void percent;
void round;
