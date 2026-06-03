
/**
 * Lifecycle do experimento WebSerial (start/stop/campaign).
 * Extraido de `experiment.js` na Sub-fase 3.4.
 */

import { appendLog, els } from "../dom.js";
import {
  ensureDisplayTicker,
  resetMetrics
} from "../metrics.js";
import {
  SCIENTIFIC_CONFIG,
  addSaturationIndicators,
  environmentToCsv
} from "../scientific.js";
import { sendSerialIntervalCommand } from "../serial.js";
import { setSimulatorInterval } from "../simulator.js";
import {
  SYNC_DRAIN_MS,
  SYNC_SAFE_INTERVAL_MS,
  createRelativeFallbackClockSync,
  synchronizeArduinoClock
} from "../clockSync.js";
import { experiment, metricsState, serialState } from "../state.js";

import { collectExperimentEnvironment } from "./exporter.js";
import {
  createMetricsSnapshot,
  storeCompletedRun
} from "./metrics-builder.js";
import {
  readCampaignConfig,
  readReplicationNumber,
  resetStartButton,
  sleep,
  stopExperimentTimers,
  updateRunningExperimentUi
} from "./ui-helpers.js";

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

  let clockSync;
  if (source === "simulator") {
    const updated = setSimulatorInterval(sendIntervalMs);
    if (!updated) {
      appendLog("Simulador offline; inicie a simulacao antes do experimento.");
    }
    clockSync = createRelativeFallbackClockSync("simulator_source", 0);
  } else {
    // Ordem importante: o Arduino precisa estar em estado idle (intervalo
    // seguro de 100 ms) durante o SYNC. Isso evita que o SYNC_REPLY fique
    // enfileirado atras de amostras pendentes em alta frequencia, o que
    // causava "syncFailed: true" / fallback `relative_offset_*`.
    if (sendIntervalMs !== SYNC_SAFE_INTERVAL_MS) {
      const safeApplied = await sendSerialIntervalCommand(SYNC_SAFE_INTERVAL_MS);
      if (!safeApplied) {
        appendLog("Falha ao colocar Arduino em 100 ms para SYNC.");
      }
      await sleep(SYNC_DRAIN_MS);
    }

    clockSync = await synchronizeArduinoClock();

    const commandSent = await sendSerialIntervalCommand(sendIntervalMs);
    if (!commandSent) {
      appendLog(
        "Intervalo registrado no experimento, mas nao foi possivel enviar comando ao Arduino."
      );
    }
  }
  metricsState.clockSync = clockSync;

  experiment.current = {
    id: `exp-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    architecture: "webserial",
    source,
    communicationMode: "webserial",
    sendIntervalMs,
    durationSeconds,
    replicationNumber: readReplicationNumber(),
    campaignType: experiment.campaign?.type ?? "official",
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
  // Atualizacoes do DOM (last sample, hr, accel, throughput, stats live) sao
  // throttled a 10 Hz por um ticker UNICO mantido em metrics.js. Aqui
  // garantimos que esta rodando — se ja foi iniciado por connectSerial ou
  // startSimulator, esta chamada e no-op.
  ensureDisplayTicker();
  appendLog("Experimento iniciado.");
  return experiment.current;
}

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

  const campaignConfig = readCampaignConfig();
  const campaignIntervalsMs = campaignConfig.intervalsMs;

  experiment.completedRuns = [];
  experiment.campaign = {
    id: `campaign-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    type: campaignConfig.type,
    architecture: "webserial",
    communicationMode: "webserial",
    source: serialState.port ? "serial" : "simulator",
    intervalsMs: [...campaignIntervalsMs],
    replicationNumber: readReplicationNumber(),
    startedAt: new Date().toISOString(),
    stoppedAt: null
  };

  const originalInterval = els.intervalMs.value;

  for (const intervalMs of campaignIntervalsMs) {
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
