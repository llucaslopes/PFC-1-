
/**
 * Lifecycle do experimento (start/stop/reset/campaign) + comunicacao com
 * o backend. Extraido de `experiments.js` na Sub-fase 3.3.
 */

import { refreshMetricsOnly, refreshSnapshots } from "../api.js";
import { drawChart } from "../chart.js";
import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock
} from "../clockSync.js";
import { configureCommunicationMode } from "../communication.js";
import { elements } from "../dom.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  collectEnvironment,
  environmentToCsv
} from "../scientific.js";
import { state } from "../state.js";

import { resetObservedData } from "./observation-recorder.js";
import { storeCompletedRun } from "./metrics-builder.js";
import {
  clearExperimentTimers,
  readReplicationNumber,
  resetStartButton,
  sleep,
  updateRunningExperimentUi
} from "./ui-helpers.js";

export function collectExperimentEnvironment(experiment) {
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
