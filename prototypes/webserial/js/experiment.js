import { downloadText, els, appendLog } from "./dom.js";
import { serializeStats, percent, resetMetrics, stats } from "./metrics.js";
import { sendSerialIntervalCommand } from "./serial.js";
import { setSimulatorInterval } from "./simulator.js";
import { toCsv } from "./csv.js";
import { experiment, metricsState, serialState } from "./state.js";

export async function startExperiment() {
  stopExperimentTimers();
  resetMetrics();
  experiment.samples = [];
  experiment.invalidMessages = [];
  experiment.metricsSnapshot = null;

  const source = serialState.port ? "serial" : "simulator";
  const durationSeconds = Math.max(1, Number(els.durationSeconds.value) || 60);
  const sendIntervalMs = Math.max(10, Number(els.intervalMs.value) || 100);

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

  experiment.current = {
    id: `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    architecture: "webserial",
    source,
    communicationMode: "webserial",
    sendIntervalMs,
    durationSeconds,
    status: "running",
    startedAt: new Date().toISOString(),
    stoppedAt: null
  };
  experiment.lastCompleted = null;
  experiment.timer = setTimeout(() => stopExperiment(true), durationSeconds * 1000);
  updateRunningExperimentUi();
  experiment.ticker = setInterval(updateRunningExperimentUi, 1000);
  appendLog("Experimento iniciado.");
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
  const expectedMessages =
    metricsState.totalMessages + metricsState.invalidMessages + metricsState.lostMessages;
  const latencyStats = stats(metricsState.processingLatencies);

  return {
    totalMessagesReceived: metricsState.totalMessages,
    totalInvalidMessages: metricsState.invalidMessages,
    lostMessages: metricsState.lostMessages,
    totalSamples: metricsState.totalMessages,
    messagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    averageMessagesPerSecond: Number((metricsState.totalMessages / elapsedSeconds).toFixed(3)),
    lostMessagesPercent: Number(percent(metricsState.lostMessages, expectedMessages).toFixed(3)),
    invalidMessagesPercent: Number(percent(metricsState.invalidMessages, expectedMessages).toFixed(3)),
    processingLatencyMs: serializeStats(latencyStats),
    heartRate: serializeStats(stats(metricsState.heartRates)),
    accelerationMagnitude: serializeStats(stats(metricsState.accelerationMagnitudes)),
    processingTimeNote:
      "Tempo de processamento local no navegador; nao e latencia fim a fim Arduino -> aplicacao."
  };
}

export function exportExperiment() {
  const current = experiment.current ?? experiment.lastCompleted;
  if (!current) {
    els.experimentStatus.textContent = "Nenhum experimento para exportar.";
    return;
  }

  downloadText("sensor-data.csv", createSensorCsv(current), "text/csv");
  downloadText("metrics.csv", createMetricsCsv(current), "text/csv");
  downloadText(
    "experiment-summary.json",
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
    "received_at",
    "seq",
    "send_ms",
    "hr",
    "ax",
    "ay",
    "az",
    "acceleration_magnitude",
    "local_processing_time_ms"
  ];
  const rows = experiment.samples.map((sample) => [
    current.id,
    current.architecture,
    current.communicationMode,
    current.source,
    sample.receivedAt,
    sample.seq,
    sample.sendMs,
    sample.hr,
    sample.ax,
    sample.ay,
    sample.az,
    sample.accelerationMagnitude.toFixed(4),
    sample.localProcessingLatencyMs.toFixed(3)
  ]);
  return toCsv([header, ...rows]);
}

function createMetricsCsv(current) {
  const metrics = experiment.metricsSnapshot ?? createMetricsSnapshot();
  const row = [
    current.id,
    current.architecture,
    current.communicationMode,
    current.source,
    current.startedAt,
    current.stoppedAt ?? "",
    current.sendIntervalMs,
    current.durationSeconds,
    metrics.totalMessagesReceived,
    metrics.totalInvalidMessages,
    metrics.lostMessages,
    metrics.averageMessagesPerSecond,
    metrics.lostMessagesPercent,
    metrics.invalidMessagesPercent,
    metrics.processingLatencyMs.average ?? "",
    metrics.processingLatencyMs.min ?? "",
    metrics.processingLatencyMs.max ?? "",
    metrics.processingLatencyMs.standardDeviation ?? "",
    metrics.heartRate.average ?? "",
    metrics.accelerationMagnitude.average ?? ""
  ];
  return toCsv([
    [
      "experiment_id",
      "architecture",
      "communication_mode",
      "source",
      "started_at",
      "stopped_at",
      "send_interval_ms",
      "duration_seconds",
      "total_messages_received",
      "total_invalid_messages",
      "lost_messages",
      "messages_per_second",
      "lost_messages_percent",
      "invalid_messages_percent",
      "local_processing_time_avg_ms",
      "local_processing_time_min_ms",
      "local_processing_time_max_ms",
      "local_processing_time_std_ms",
      "hr_avg",
      "acceleration_magnitude_avg"
    ],
    row
  ]);
}

function createSummary(current) {
  const metrics = experiment.metricsSnapshot ?? createMetricsSnapshot();

  return {
    experiment: current,
    metrics,
    invalidMessages: experiment.invalidMessages,
    interpretation: {
      processingTimeNote:
        "O tempo registrado e de processamento local no navegador, nao latencia fim a fim Arduino -> aplicacao. O campo send_ms usa millis()/temporizador local e nao esta sincronizado com o relogio do computador.",
      averageThroughput: `${metrics.averageMessagesPerSecond} mensagens/s`,
      hadLostMessages: metrics.lostMessages > 0,
      hadInvalidMessages: metrics.totalInvalidMessages > 0,
      realTimeAdequacy:
        "WebSerial e direto e simples para um unico navegador, mas fica limitado ao suporte do navegador e ao computador conectado ao Arduino."
    }
  };
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
