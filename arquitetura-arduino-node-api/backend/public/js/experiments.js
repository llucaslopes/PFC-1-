import { refreshMetricsOnly, refreshSnapshots } from "./api.js";
import { drawChart } from "./chart.js";
import { configureCommunicationMode } from "./communication.js";
import { downloadText, elements } from "./dom.js";
import { state } from "./state.js";

export async function startExperiment() {
  clearExperimentTimers();

  const payload = {
    architecture: "backend-node",
    source: elements.experimentSource.value,
    communicationMode: elements.communicationMode.value,
    sendIntervalMs: Number(elements.sendIntervalMs.value) || 100,
    durationSeconds: Number(elements.durationSeconds.value) || 60
  };

  const response = await fetch("/experiments/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const experiment = await response.json();

  state.points = [];
  state.seenRestSequences.clear();
  state.currentExperiment = experiment;
  updateRunningExperimentUi();
  state.experimentTicker = window.setInterval(updateRunningExperimentUi, 1000);
  state.experimentAutoStopTimer = window.setTimeout(() => {
    stopExperiment(true);
  }, experiment.durationSeconds * 1000);
  configureCommunicationMode();
  await refreshSnapshots();
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

  const experiment = await response.json();
  state.currentExperiment = experiment;
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
  elements.experimentStatus.textContent = "Metricas zeradas";
  resetStartButton();
  drawChart();
  await refreshSnapshots();
}

export async function exportExperiment() {
  const response = await fetch("/experiments/export");

  if (!response.ok) {
    elements.experimentStatus.textContent = "Nenhum experimento para exportar";
    return;
  }

  const exportedExperiment = await response.json();
  downloadText("sensor-data.csv", exportedExperiment.sensorDataCsv, "text/csv");
  downloadText("metrics.csv", exportedExperiment.metricsCsv, "text/csv");
  downloadText("experiment-summary.json", exportedExperiment.summaryJson, "application/json");
  elements.experimentStatus.textContent = "Arquivos exportados";
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
