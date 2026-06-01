
/**
 * Helpers de UI + temporizadores do prototipo WebSerial.
 * Extraido de `experiment.js` na Sub-fase 3.4.
 */

import { applyDisplayUpdate } from "../metrics.js";
import { SCIENTIFIC_CONFIG } from "../scientific.js";
import { els } from "../dom.js";
import { experiment } from "../state.js";

// O display ticker (10 Hz) NAO e mais derrubado por stopExperimentTimers:
// ele e gerenciado por connectSerial / startSimulator (e seus pares de stop).
// Assim, parar um experimento mantem a UI viva enquanto a serial/simulador
// continuam alimentando metricsState. O drain final via applyDisplayUpdate
// abaixo garante que os ultimos numeros materializem no DOM.

export function readReplicationNumber() {
  return Math.max(1, Number(els.replicationNumber?.value) || 1);
}

export function readCampaignConfig() {
  const automatedConfig = window.__PFC_EXPERIMENT_CAMPAIGN;
  const intervalsMs = Array.isArray(automatedConfig?.intervalsMs)
    ? automatedConfig.intervalsMs.filter((value) => Number.isFinite(value) && value > 0)
    : [];

  return {
    type: typeof automatedConfig?.type === "string" ? automatedConfig.type : "official",
    intervalsMs: intervalsMs.length ? intervalsMs : [...SCIENTIFIC_CONFIG.stressIntervalsMs]
  };
}

export function updateRunningExperimentUi() {
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

export function resetStartButton() {
  els.experimentStart.disabled = false;
  els.experimentStart.textContent = "Iniciar experimento";
}

export function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stopExperimentTimers() {
  if (experiment.timer) {
    clearTimeout(experiment.timer);
    experiment.timer = null;
  }

  if (experiment.ticker) {
    clearInterval(experiment.ticker);
    experiment.ticker = null;
  }

  // Drena uma ultima atualizacao para o DOM refletir os ultimos numeros
  // imediatamente quando o experimento termina, sem esperar o proximo tick.
  applyDisplayUpdate();
}
