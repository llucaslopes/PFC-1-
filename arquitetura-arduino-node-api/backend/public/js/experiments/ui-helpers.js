
/**
 * Helpers de UI / temporizadores do frontend backend client. Extraido de
 * `experiments.js` na Sub-fase 3.3. Todas as funcoes mantem o
 * comportamento bit-a-bit, incluindo formatacao de strings/lable.
 */

import { elements } from "../dom.js";
import { state } from "../state.js";

export function readReplicationNumber() {
  return Math.max(1, Number(elements.replicationNumber?.value) || 1);
}

export function updateRunningExperimentUi() {
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

export function clearExperimentTimers() {
  if (state.experimentAutoStopTimer) {
    window.clearTimeout(state.experimentAutoStopTimer);
    state.experimentAutoStopTimer = null;
  }

  if (state.experimentTicker) {
    window.clearInterval(state.experimentTicker);
    state.experimentTicker = null;
  }
}

export function resetStartButton() {
  elements.startExperiment.disabled = false;
  elements.startExperiment.textContent = "Iniciar";
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
