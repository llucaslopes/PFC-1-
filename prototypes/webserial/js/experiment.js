import { appendLog, downloadText, els } from "./dom.js";
import { percent, resetMetrics, serializeStats, stats } from "./metrics.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  collectEnvironment,
  createDownloadFilename,
  createRawRows,
  createExperimentExportBlock,
  createRunSummary,
  createSaturationAnalysis,
  createSummaryRow,
  environmentToCsv,
  numericStats
} from "./scientific.js";
import { sendSerialIntervalCommand } from "./serial.js";
import { setSimulatorInterval } from "./simulator.js";
import { toCsv } from "./csv.js";
import { createRelativeFallbackClockSync, synchronizeArduinoClock } from "./clockSync.js";
import { experiment, metricsState, serialState } from "./state.js";

export async function startExperiment() {
  experiment.completedRuns = [];
  experiment.campaign = null;
  await startSingleExperiment();
}

export async function startCampaign() {
  if (experiment.current?.status === "running") {
    appendLog("Ja existe experimento em execucao.");
    return;
  }

  experiment.completedRuns = [];
  experiment.campaign = {
    id: `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    architecture: "webserial",
    communicationMode: "webserial",
    source: serialState.port ? "serial" : "simulator",
    intervalsMs: [...SCIENTIFIC_CONFIG.stressIntervalsMs],
    replicationNumber: readReplicationNumber(),
    startedAt: new Date().toISOString(),
    stoppedAt: null
  };

  const originalInterval = els.intervalMs.value;

  for (const intervalMs of SCIENTIFIC_CONFIG.stressIntervalsMs) {
    els.intervalMs.value = String(intervalMs);
    appendLog(`Campanha: iniciando intervalo ${intervalMs} ms.`);
    const current = await startSingleExperiment();
    await sleep(current.durationSeconds * 1000 + 100);

    if (experiment.current?.status === "running") {
      stopExperiment(true);
    }
  }

  els.intervalMs.value = originalInterval;
  experiment.campaign.stoppedAt = new Date().toISOString();
  addSaturationIndicators(experiment.completedRuns.map((run) => run.summary));
  els.experimentStatus.textContent = "Campanha concluida. Exporte os resultados.";
  appendLog("Campanha concluida.");
}

async function startSingleExperiment() {
  stopExperimentTimers();
  resetMetrics();
  experiment.samples = [];
  experiment.invalidMessages = [];
  experiment.metricsSnapshot = null;

  const source = serialState.port ? "serial" : "simulator";
  const durationSeconds = Math.max(1, Number(els.durationSeconds.value) || 60);
  const sendIntervalMs = Math.max(
    SCIENTIFIC_CONFIG.minimumIntervalMs,
    Number(els.intervalMs.value) || 100
  );

  if (source === "simulator") {
    const updated = setSimulatorInterval(sendIntervalMs);
    if (!updated) {
      appendLog("Simulador offline; inicie a simulacao antes do experimento.");
    }
  } else {
    const commandSent = await sendSerialIntervalCommand(sendIntervalMs);
    if (!commandSent) {
      appendLog(
        "Intervalo registrado no experimento, mas nao foi possivel enviar comando ao Arduino."
      );
    }
  }

  const clockSync =
    source === "serial"
      ? await synchronizeArduinoClock()
      : createRelativeFallbackClockSync("simulator_source", 0);
  metricsState.clockSync = clockSync;

  experiment.current = {
    id: `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    architecture: "webserial",
    source,
    communicationMode: "webserial",
    sendIntervalMs,
    durationSeconds,
    replicationNumber: readReplicationNumber(),
    clockSync,
    status: "running",
    startedAt: new Date().toISOString(),
    stoppedAt: null
  };
  experiment.current.environment = collectExperimentEnvironment(experiment.current);
  experiment.current.environmentText = environmentToCsv(experiment.current.environment);
  experiment.lastCompleted = null;
  experiment.timer = setTimeout(() => stopExperiment(true), durationSeconds * 1000);
  updateRunningExperimentUi();
  experiment.ticker = setInterval(updateRunningExperimentUi, 1000);
  appendLog("Experimento iniciado.");
  return experiment.current;
}

export function stopExperiment(automatic = false) {
  stopExperimentTimers();
  if (!experiment.current) {
    els.experimentStatus.textContent = "Nenhum experimento em execucao.";
    resetStartButton();
    return;
  }

  experiment.current = {
    ...experiment.current,
    status: "stopped",
    stoppedAt: new Date().toISOString()
  };
  experiment.metricsSnapshot = createMetricsSnapshot();
  storeCompletedRun();
  experiment.lastCompleted = experiment.current;
  els.experimentStatus.textContent = `Experimento parado em ${new Date(
    experiment.current.stoppedAt
  ).toLocaleTimeString()}${automatic ? " automaticamente" : ""}`;
  resetStartButton();
  appendLog(automatic ? "Experimento parado automaticamente." : "Experimento parado.");
}

export function stopExperimentTimer() {
  stopExperimentTimers();
}

function stopExperimentTimers() {
  if (experiment.timer) {
    clearTimeout(experiment.timer);
    experiment.timer = null;
  }

  if (experiment.ticker) {
    clearInterval(experiment.ticker);
    experiment.ticker = null;
  }
}

export function recordExperimentSample(sample) {
  if (experiment.current?.status !== "running") {
    return;
  }

  experiment.samples.push(sample);
}

export function recordExperimentInvalid(rawLine) {
  if (experiment.current?.status !== "running") {
    return;
  }

  experiment.invalidMessages.push({
    receivedAt: new Date().toISOString(),
    rawLine
  });
}

export function createMetricsSnapshot() {
  const elapsedSeconds = experiment.current
    ? Math.max((Date.now() - Date.parse(experiment.current.startedAt)) / 1000, 1)
    : 1;
  const expectedMessages = experiment.current
    ? Math.floor((experiment.current.durationSeconds * 1000) / experiment.current.sendIntervalMs)
    : metricsState.totalMessages + metricsState.invalidMessages + metricsState.sequenceGapMessages;
  const processingStats = stats(metricsState.processingLatencies);
  const latencyStats = numericStats(metricsState.endToEndLatencies);
  const missingMessages = Math.max(0, expectedMessages - metricsState.totalMessages);
  const baseline = metricsState.latencyCalibrator?.getBaseline() ?? {
    sendMs: null,
    receiveMs: null
  };

  return {
    totalMessagesReceived: metricsState.totalMessages,
    totalInvalidMessages: metricsState.invalidMessages,
    missingMessages,
    sequenceGapMessages: metricsState.sequenceGapMessages,
    lostMessages: missingMessages,
    totalSamples: metricsState.totalMessages,
    expectedMessages,
    messagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    averageMessagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    throughputPercent: Number(percent(metricsState.totalMessages, expectedMessages).toFixed(3)),
    missingMessagesPercent: Number(percent(missingMessages, expectedMessages).toFixed(3)),
    lostMessagesPercent: Number(percent(missingMessages, expectedMessages).toFixed(3)),
    invalidMessagesPercent: Number(percent(metricsState.invalidMessages, expectedMessages).toFixed(3)),
    latencyEstimationMethod: getLatencyMethod(experiment.current?.clockSync),
    latencyType: getLatencyType(experiment.current?.clockSync),
    latencyMethod: getLatencyMethod(experiment.current?.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: experiment.current?.clockSync ?? metricsState.clockSync ?? null,
    latencyBaselineSendMs: baseline.sendMs,
    latencyBaselineReceiveMs: baseline.receiveMs,
    estimatedEndToEndLatencyMs: {
      samples: latencyStats.samples,
      average: latencyStats.average,
      min: latencyStats.min,
      max: latencyStats.max,
      standardDeviation: latencyStats.standardDeviation,
      p95: latencyStats.p95
    },
    processingLatencyMs: serializeStats(processingStats),
    heartRate: serializeStats(stats(metricsState.heartRates)),
    accelerationMagnitude: serializeStats(stats(metricsState.accelerationMagnitudes)),
    processingTimeNote:
      "Tempo de processamento local no navegador; a latencia fim a fim e uma estimativa relativa, nao uma latencia absoluta real."
  };
}

export function exportExperiment() {
  const current = experiment.current ?? experiment.lastCompleted;
  if (!current) {
    els.experimentStatus.textContent = "Nenhum experimento para exportar.";
    return;
  }

  const replicationNumber = current.replicationNumber ?? readReplicationNumber();
  downloadText(
    createDownloadFilename(current, "sensor-data", "csv", replicationNumber),
    createSensorCsv(current),
    "text/csv"
  );
  downloadText(
    createDownloadFilename(current, "metrics", "csv", replicationNumber),
    createMetricsCsv(current),
    "text/csv"
  );
  if (experiment.completedRuns.length) {
    downloadText(
      createDownloadFilename(current, "campaign-summary", "csv", replicationNumber),
      createCampaignSummaryCsv(),
      "text/csv"
    );
  }
  downloadText(
    createDownloadFilename(current, "experiment-summary", "json", replicationNumber),
    JSON.stringify(createSummary(current), null, 2),
    "application/json"
  );
  els.experimentStatus.textContent = "Arquivos exportados.";
}

function createSensorCsv(current) {
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
  const rows = experiment.completedRuns.length
    ? experiment.completedRuns.flatMap((run) => createRawRows(run.experiment, run.samples))
    : createRawRows(current, experiment.samples);
  return toCsv([header, ...rows]);
}

function createMetricsCsv(current) {
  const summaries = experiment.completedRuns.length
    ? addSaturationIndicators(experiment.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment: current,
          samples: experiment.samples,
          invalidMessages: experiment.invalidMessages,
          sequenceGapMessages: metricsState.sequenceGapMessages
        })
      ]);

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
}

function createSummary(current) {
  const metrics = experiment.metricsSnapshot ?? createMetricsSnapshot();
  const summaries = experiment.completedRuns.length
    ? addSaturationIndicators(experiment.completedRuns.map((run) => run.summary))
    : addSaturationIndicators([
        createRunSummary({
          experiment: current,
          samples: experiment.samples,
          invalidMessages: experiment.invalidMessages,
          sequenceGapMessages: metricsState.sequenceGapMessages
        })
      ]);
  const primarySummary = summaries[0];
  const exportBlock = primarySummary ? createExperimentExportBlock(primarySummary) : null;
  const { saturationAnalysis, saturation } = createSaturationAnalysis(summaries);
  const campaign = experiment.campaign
    ? {
        ...experiment.campaign,
        stoppedAt: experiment.campaign.stoppedAt,
        applicationVersion: SCIENTIFIC_CONFIG.applicationVersion
      }
    : null;

  return {
    ...exportBlock,
    campaign,
    runs: summaries,
    saturationAnalysis,
    saturation,
    architecture: current.architecture,
    communicationMode: current.communicationMode,
    source: current.source,
    intervalMs: current.sendIntervalMs,
    durationSeconds: current.durationSeconds,
    startedAt: current.startedAt,
    stoppedAt: current.stoppedAt,
    replicationNumber: current.replicationNumber ?? readReplicationNumber(),
    environment: current.environment ?? collectExperimentEnvironment(current),
    applicationVersion: SCIENTIFIC_CONFIG.applicationVersion,
    latencyType: getLatencyType(current.clockSync),
    latencyMethod: getLatencyMethod(current.clockSync),
    latencyLimitation: SCIENTIFIC_CONFIG.latencyLimitation,
    latencyEstimationMethod: getLatencyMethod(current.clockSync),
    latencyMethodologyNote: SCIENTIFIC_CONFIG.latencyMethodologyNote,
    clockSync: current.clockSync ?? null,
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
    experiment: current,
    metrics,
    scientificSummary: summaries.length === 1 ? summaries[0] : summaries,
    invalidMessages: experiment.invalidMessages,
    interpretation: {
      processingTimeNote:
        SCIENTIFIC_CONFIG.latencyMethodologyNote,
      averageThroughput: `${metrics.averageMessagesPerSecond} mensagens/s`,
      hadLostMessages: metrics.missingMessages > 0,
      hadInvalidMessages: metrics.totalInvalidMessages > 0,
      realTimeAdequacy:
        "WebSerial e direto e simples para um unico navegador, mas fica limitado ao suporte do navegador e ao computador conectado ao Arduino."
    }
  };
}

function storeCompletedRun() {
  if (!experiment.current || !experiment.metricsSnapshot) {
    return;
  }

  experiment.completedRuns.push({
    experiment: experiment.current,
    samples: [...experiment.samples],
    invalidMessages: [...experiment.invalidMessages],
    summary: createRunSummary({
      experiment: experiment.current,
      samples: experiment.samples,
      invalidMessages: experiment.invalidMessages,
      sequenceGapMessages: metricsState.sequenceGapMessages
    })
  });
}

function createCampaignSummaryCsv() {
  const summaries = addSaturationIndicators(experiment.completedRuns.map((run) => run.summary));

  return toCsv([createExperimentRunsHeader(), ...summaries.map(createSummaryRow)]);
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
  return clockSync?.syncFailed
    ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
    : "ntp_style_clock_synchronization";
}

function readReplicationNumber() {
  return Math.max(1, Number(els.replicationNumber?.value) || 1);
}

function collectExperimentEnvironment(current) {
  return collectEnvironment({
    architecture: current?.architecture ?? "webserial",
    communicationMode: "webserial",
    source: current?.source ?? (serialState.port ? "serial" : "simulator"),
    intervalMs: current?.sendIntervalMs ?? (Number(els.intervalMs.value) || 100),
    baudRate: Number(els.baud.value) || 115200
  });
}

function updateRunningExperimentUi() {
  const current = experiment.current;

  if (!current || current.status !== "running") {
    return;
  }

  const elapsedSeconds = Math.min(
    current.durationSeconds,
    Math.floor((Date.now() - Date.parse(current.startedAt)) / 1000)
  );
  const elapsedLabel = formatDuration(elapsedSeconds);
  const durationLabel = formatDuration(current.durationSeconds);

  els.experimentStart.disabled = true;
  els.experimentStart.textContent = `Em execucao ${elapsedLabel} / ${durationLabel}`;
  els.experimentStatus.textContent = `Experimento em execucao: ${current.source}, ${current.sendIntervalMs} ms, ${elapsedLabel} / ${durationLabel}`;
}

function resetStartButton() {
  els.experimentStart.disabled = false;
  els.experimentStart.textContent = "Iniciar experimento";
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
