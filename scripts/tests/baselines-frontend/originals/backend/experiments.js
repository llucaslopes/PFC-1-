import { refreshMetricsOnly, refreshSnapshots } from "./api.js";
import { drawChart } from "./chart.js";
import { configureCommunicationMode } from "./communication.js";
import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock
} from "./clockSync.js";
import { downloadText, elements } from "./dom.js";
import { LATENCY_METHOD_FALLBACK, LATENCY_METHOD_SYNC } from "./clockSync.js";
import {
  computeEndToEndLatency,
  remoteSendToHostMs
} from "./clockSyncMath.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  collectEnvironment,
  createExperimentExportBlock,
  createLatencyCalibrator,
  createDownloadFilename,
  createRawRows,
  createRunSummary,
  createSaturationAnalysis,
  createSummaryRow,
  environmentToCsv,
  numericStats,
  percent,
  round
} from "./scientific.js";
import { state } from "./state.js";

export async function startExperiment() {
  state.completedRuns = [];
  state.campaign = null;
  await startSingleExperiment();
}

export async function startCampaign() {
  if (state.currentExperiment?.status === "running") {
    elements.experimentStatus.textContent = "Ja existe experimento em execucao";
    return;
  }

  state.completedRuns = [];
  state.campaign = {
    id: `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    architecture: "backend-node",
    communicationMode: elements.communicationMode.value,
    source: elements.experimentSource.value,
    intervalsMs: [...SCIENTIFIC_CONFIG.stressIntervalsMs],
    replicationNumber: readReplicationNumber(),
    startedAt: new Date().toISOString(),
    stoppedAt: null
  };

  const originalInterval = elements.sendIntervalMs.value;

  for (const intervalMs of SCIENTIFIC_CONFIG.stressIntervalsMs) {
    elements.sendIntervalMs.value = String(intervalMs);
    const experiment = await startSingleExperiment();
    await sleep(experiment.durationSeconds * 1000 + 100);

    if (state.currentExperiment?.status === "running") {
      await stopExperiment(true);
    }
  }

  elements.sendIntervalMs.value = originalInterval;
  state.campaign.stoppedAt = new Date().toISOString();
  addSaturationIndicators(state.completedRuns.map((run) => run.summary));
  elements.experimentStatus.textContent = "Campanha concluida. Exporte os resultados.";
  configureCommunicationMode();
}

async function startSingleExperiment() {
  clearExperimentTimers();
  resetObservedData();

  const payload = {
    architecture: "backend-node",
    source: elements.experimentSource.value,
    communicationMode: elements.communicationMode.value,
    sendIntervalMs: Math.max(
      SCIENTIFIC_CONFIG.minimumIntervalMs,
      Number(elements.sendIntervalMs.value) || 100
    ),
    durationSeconds: Number(elements.durationSeconds.value) || 60,
    replicationNumber: readReplicationNumber()
  };

  const frontendBackendSync = await synchronizeBackendClock();
  const response = await fetch("/experiments/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const experiment = await response.json();
  const clockSync = mergeClockSync(
    experiment.clockSync ?? createRelativeFallbackClockSync("backend_arduino_sync_missing", 0),
    frontendBackendSync
  );

  state.points = [];
  state.seenRestSequences.clear();
  state.clockSync = clockSync;
  state.currentExperiment = { ...experiment, clockSync };
  state.currentExperiment.environment = collectExperimentEnvironment(experiment);
  state.currentExperiment.environmentText = environmentToCsv(state.currentExperiment.environment);
  updateRunningExperimentUi();
  state.experimentTicker = window.setInterval(updateRunningExperimentUi, 1000);
  state.experimentAutoStopTimer = window.setTimeout(() => {
    stopExperiment(true);
  }, experiment.durationSeconds * 1000);
  configureCommunicationMode();
  await refreshSnapshots();
  return experiment;
}

export async function stopExperiment(automatic = false) {
  clearExperimentTimers();
  const response = await fetch("/experiments/stop", { method: "POST" });

  if (!response.ok) {
    elements.experimentStatus.textContent = "Nenhum experimento em execucao";
    state.currentExperiment = null;
    resetStartButton();
    return;
  }

  const previousExperiment = state.currentExperiment;
  const experiment = {
    ...(await response.json()),
    clockSync: previousExperiment?.clockSync ?? state.clockSync,
    environment: previousExperiment?.environment ?? collectExperimentEnvironment(previousExperiment),
    environmentText:
      previousExperiment?.environmentText ??
      environmentToCsv(collectExperimentEnvironment(previousExperiment)),
    replicationNumber: previousExperiment?.replicationNumber ?? readReplicationNumber()
  };
  state.currentExperiment = experiment;
  const run = storeCompletedRun(experiment);
  await sendExperimentObservation(run);
  elements.experimentStatus.textContent = `Experimento parado em ${new Date(
    experiment.stoppedAt
  ).toLocaleTimeString()}${automatic ? " automaticamente" : ""}`;
  resetStartButton();
  await refreshMetricsOnly();
}

export async function resetExperiment() {
  clearExperimentTimers();
  await fetch("/experiments/reset", { method: "POST" });
  state.points = [];
  state.seenRestSequences.clear();
  state.currentExperiment = null;
  state.completedRuns = [];
  state.campaign = null;
  resetObservedData();
  elements.experimentStatus.textContent = "Metricas zeradas";
  resetStartButton();
  drawChart();
  await refreshSnapshots();
}

export function recordObservedMessage(message) {
  if (state.currentExperiment?.status !== "running") {
    return;
  }

  const startedAt = performance.now();
  const sensor = message.sensor;
  if (Date.parse(message.receivedAt) < Date.parse(state.currentExperiment.startedAt)) {
    return;
  }

  const receiveMs = performance.now();
  const seq = sensor.id;

  if (state.lastObservedSeq !== null && seq > state.lastObservedSeq + 1) {
    state.observedSequenceGapMessages += seq - state.lastObservedSeq - 1;
    state.observedLostMessages = state.observedSequenceGapMessages;
  }
  state.lastObservedSeq = seq;

  const sendUs = message.arduinoSendUs ?? Math.round(sensor.sendUs ?? sensor.timestamp * 1000);
  const sendMs = sensor.timestamp;
  const relativeEstimatedLatencyMs = state.latencyCalibrator.calculate(sendMs, receiveMs);
  const backendToFrontendOffsetMs =
    state.clockSync?.backendToFrontendOffsetMs ?? state.clockSync?.frontendBackendOffsetMs;
  const hasSynchronizedClock =
    state.clockSync &&
    !state.clockSync.syncFailed &&
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
      (state.clockSync.backendToFrontendUncertaintyMs ??
        state.clockSync.frontendBackendUncertaintyMs ??
        0)
    : null;
  const syncRttMs = hasSynchronizedClock
    ? (state.clockSync.backendToFrontendRttMs ?? state.clockSync.frontendBackendRttMs ?? null)
    : null;
  const localProcessingLatencyMs = performance.now() - startedAt;

  state.observedSamples.push({
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
    localProcessingLatencyMs
  });

  const latencyStats = numericStats(
    state.observedSamples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  elements.latency.textContent =
    latencyStats.average === null ? "--" : `${latencyStats.average.toFixed(3)} ms`;
}

export async function exportExperiment() {
  const current = state.currentExperiment;

  if (!current && !state.completedRuns.length) {
    elements.experimentStatus.textContent = "Nenhum experimento para exportar";
    return;
  }

  const experiment = current ?? state.completedRuns[state.completedRuns.length - 1].experiment;
  const replicationNumber = experiment.replicationNumber ?? readReplicationNumber();
  downloadText(
    createDownloadFilename(experiment, "sensor-data", "csv", replicationNumber),
    createSensorCsv(experiment),
    "text/csv"
  );
  downloadText(
    createDownloadFilename(experiment, "metrics", "csv", replicationNumber),
    createMetricsCsv(experiment),
    "text/csv"
  );
  if (state.completedRuns.length) {
    downloadText(
      createDownloadFilename(experiment, "campaign-summary", "csv", replicationNumber),
      createCampaignSummaryCsv(),
      "text/csv"
    );
  }
  downloadText(
    createDownloadFilename(experiment, "experiment-summary", "json", replicationNumber),
    JSON.stringify(createSummary(experiment), null, 2),
    "application/json"
  );
  elements.experimentStatus.textContent = "Arquivos exportados";
}

function resetObservedData() {
  state.observedSamples = [];
  state.invalidMessages = [];
  state.latencyCalibrator = createLatencyCalibrator();
  state.clockSync = null;
  state.lastObservedSeq = null;
  state.observedLostMessages = 0;
  state.observedSequenceGapMessages = 0;
}

function readReplicationNumber() {
  return Math.max(1, Number(elements.replicationNumber?.value) || 1);
}

function collectExperimentEnvironment(experiment) {
  return collectEnvironment({
    architecture: experiment?.architecture ?? "backend-node",
    communicationMode: experiment?.communicationMode ?? elements.communicationMode.value,
    source: experiment?.source ?? elements.experimentSource.value,
    intervalMs: experiment?.sendIntervalMs ?? (Number(elements.sendIntervalMs.value) || 100)
  });
}

async function sendExperimentObservation(run) {
  if (!run) {
    return;
  }

  try {
    await fetch("/experiments/observations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        experimentId: run.experiment.id,
        campaignId: state.campaign?.id ?? null,
        replicationNumber: run.experiment.replicationNumber ?? readReplicationNumber(),
        environment: run.experiment.environment ?? collectExperimentEnvironment(run.experiment),
        samples: run.samples,
        invalidMessages: run.invalidMessages,
        summary: run.summary
      })
    });
  } catch {
    elements.experimentStatus.textContent =
      "Experimento parado; nao foi possivel enviar observacoes ao backend.";
  }
}

function createObservedMetrics(experiment) {
  const samples = state.observedSamples;
  const expectedMessages = Math.floor((experiment.durationSeconds * 1000) / experiment.sendIntervalMs);
  const elapsedSeconds = Math.max(
    ((Date.parse(experiment.stoppedAt ?? new Date().toISOString()) - Date.parse(experiment.startedAt)) /
      1000),
    1
  );
  const latencies = numericStats(
    samples.map((sample) => sample.endToEndLatencyMs ?? sample.estimatedEndToEndLatencyMs)
  );
  const missingMessages = Math.max(0, expectedMessages - samples.length);
  const baseline = state.latencyCalibrator?.getBaseline() ?? {
    sendMs: samples[0]?.sendMs ?? null,
    receiveMs: samples[0]?.receiveMs ?? null
  };

  return {
    expectedMessages,
    totalMessagesReceived: samples.length,
    totalInvalidMessages: state.invalidMessages.length,
    missingMessages,
    sequenceGapMessages: state.observedSequenceGapMessages,
    lostMessages: missingMessages,
    averageMessagesPerSecond: round(samples.length / elapsedSeconds),
    throughputPercent: percent(samples.length, expectedMessages),
    missingMessagesPercent: percent(missingMessages, expectedMessages),
    lostMessagesPercent: percent(missingMessages, expectedMessages),
    latencyEstimationMethod: getLatencyMethod(state.clockSync),
    latencyType: state.clockSync?.syncFailed ? "relative_fallback" : SCIENTIFIC_CONFIG.latencyType,
    latencyMethod: state.clockSync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : SCIENTIFIC_CONFIG.latencyMethod,
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: state.clockSync,
    latencyBaselineSendMs: baseline.sendMs,
    latencyBaselineReceiveMs: baseline.receiveMs,
    estimatedEndToEndLatencyMs: latencies
  };
}

function storeCompletedRun(experiment) {
  const samples = [...state.observedSamples];
  const invalidMessages = [...state.invalidMessages];

  const run = {
    experiment,
    samples,
    invalidMessages,
    summary: createRunSummary({
      experiment,
      samples,
      invalidMessages,
      sequenceGapMessages: state.observedSequenceGapMessages
    })
  };

  state.completedRuns.push(run);
  return run;
}

function createSensorCsv(experiment) {
  const header = [
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
  const rows = state.completedRuns.length
    ? state.completedRuns.flatMap((run) => createRawRows(run.experiment, run.samples))
    : createRawRows(experiment, state.observedSamples);

  return toCsv([header, ...rows]);
}

function createMetricsCsv(experiment) {
  const summaries = state.completedRuns.length
    ? addSaturationIndicators(state.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment,
          samples: state.observedSamples,
          invalidMessages: state.invalidMessages,
          sequenceGapMessages: state.observedSequenceGapMessages
        })
      ]);

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}

function createCampaignSummaryCsv() {
  const summaries = addSaturationIndicators(state.completedRuns.map((run) => run.summary));

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}

function createSummary(experiment) {
  const metrics = createObservedMetrics(experiment);
  const summaries = state.completedRuns.length
    ? addSaturationIndicators(state.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment,
          samples: state.observedSamples,
          invalidMessages: state.invalidMessages,
          sequenceGapMessages: state.observedSequenceGapMessages
        })
      ]);
  const primarySummary = summaries[0];
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(summaries);
  const campaign = state.campaign
    ? {
        ...state.campaign,
        stoppedAt: state.campaign.stoppedAt,
        applicationVersion: SCIENTIFIC_CONFIG.applicationVersion
      }
    : null;

  return {
    ...exportBlock,
    campaign,
    runs: summaries,
    saturationAnalysis,
    saturation,
    architecture: experiment.architecture,
    communicationMode: experiment.communicationMode,
    source: experiment.source,
    intervalMs: experiment.sendIntervalMs,
    durationSeconds: experiment.durationSeconds,
    startedAt: experiment.startedAt,
    stoppedAt: experiment.stoppedAt,
    replicationNumber: experiment.replicationNumber ?? readReplicationNumber(),
    environment: experiment.environment ?? collectExperimentEnvironment(experiment),
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: getLatencyType(experiment.clockSync),
    latencyMethod: getLatencyMethod(experiment.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: getLatencyMethod(experiment.clockSync),
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: experiment.clockSync ?? state.clockSync,
    latencyBaselineSendMs: primarySummary?.latencyBaselineSendMs ?? null,
    latencyBaselineReceiveMs: primarySummary?.latencyBaselineReceiveMs ?? null,
    expectedMessages: primarySummary?.expectedMessages ?? metrics.expectedMessages,
    receivedMessages: primarySummary?.receivedMessages ?? metrics.totalMessagesReceived,
    missingMessages: primarySummary?.missingMessages ?? metrics.missingMessages,
    sequenceGapMessages: primarySummary?.sequenceGapMessages ?? metrics.sequenceGapMessages,
    throughputPercent: primarySummary?.throughputPercent ?? metrics.throughputPercent,
    estimatedLatencyMs: {
      samples: primarySummary?.estimatedLatencySamples ?? metrics.estimatedEndToEndLatencyMs.samples,
      average: primarySummary?.estimatedLatencyAverageMs ?? metrics.estimatedEndToEndLatencyMs.average,
      min: primarySummary?.estimatedLatencyMinMs ?? metrics.estimatedEndToEndLatencyMs.min,
      max: primarySummary?.estimatedLatencyMaxMs ?? metrics.estimatedEndToEndLatencyMs.max,
      standardDeviation:
        primarySummary?.estimatedLatencyStdDevMs ??
        metrics.estimatedEndToEndLatencyMs.standardDeviation,
      p95: primarySummary?.estimatedLatencyP95Ms ?? metrics.estimatedEndToEndLatencyMs.p95
    },
    saturationIndicators: primarySummary?.saturationIndicators ?? [],
    saturationIndicatorCodes: primarySummary?.saturationIndicatorCodes ?? [],
    methodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    experiment,
    metrics,
    scientificSummary: summaries.length === 1 ? summaries[0] : summaries,
    interpretation: {
      processingTimeNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${metrics.averageMessagesPerSecond} mensagens/s`,
      realTimeAdequacy:
        experiment.communicationMode === "websocket"
          ? "WebSocket tende a ser mais adequado para tempo real por entregar eventos por push."
          : "REST polling e util para comparacao, mas pode repetir amostras ou perder atualizacoes entre requisicoes."
    }
  };
}

function createExperimentRunsHeader() {
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

function getLatencyType(clockSync) {
  return clockSync?.syncFailed
    ? "relative_fallback"
    : "clock_synchronized_estimated_end_to_end";
}

function getLatencyMethod(clockSync) {
  return clockSync?.syncFailed ? LATENCY_METHOD_FALLBACK : LATENCY_METHOD_SYNC;
}

function updateRunningExperimentUi() {
  const experiment = state.currentExperiment;

  if (!experiment || experiment.status !== "running") {
    return;
  }

  const elapsedSeconds = Math.min(
    experiment.durationSeconds,
    Math.floor((Date.now() - Date.parse(experiment.startedAt)) / 1000)
  );
  const elapsedLabel = formatDuration(elapsedSeconds);
  const durationLabel = formatDuration(experiment.durationSeconds);

  elements.startExperiment.disabled = true;
  elements.startExperiment.textContent = `Em execucao ${elapsedLabel} / ${durationLabel}`;
  elements.experimentStatus.textContent = `Experimento em execucao: ${experiment.communicationMode}, ${experiment.sendIntervalMs} ms, ${elapsedLabel} / ${durationLabel}`;
}

function clearExperimentTimers() {
  if (state.experimentAutoStopTimer) {
    window.clearTimeout(state.experimentAutoStopTimer);
    state.experimentAutoStopTimer = null;
  }

  if (state.experimentTicker) {
    window.clearInterval(state.experimentTicker);
    state.experimentTicker = null;
  }
}

function resetStartButton() {
  elements.startExperiment.disabled = false;
  elements.startExperiment.textContent = "Iniciar";
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const text = String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
