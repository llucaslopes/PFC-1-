
/**
 * Dispara o download dos 4 arquivos do experimento (sensor-data, metrics,
 * campaign-summary, experiment-summary). Tambem prove
 * `collectExperimentEnvironment` (usado por lifecycle e summary).
 * Extraido de `experiment.js` (Sub-fase 3.4).
 */

import { downloadText, els } from "../dom.js";
import {
  collectEnvironment,
  createDownloadFilename
} from "../scientific.js";
import { experiment, serialState } from "../state.js";

import {
  createCampaignSummaryCsv,
  createMetricsCsv,
  createSensorCsv
} from "./metrics-builder.js";
import { createSummary } from "./summary-builder.js";

export function collectExperimentEnvironment(current) {
  return collectEnvironment({
    architecture: current?.architecture ?? "webserial",
    communicationMode: "webserial",
    source: current?.source ?? (serialState.port ? "serial" : "simulator"),
    intervalMs: current?.sendIntervalMs ?? (Number(els.intervalMs.value) || 100),
    campaignType: current?.campaignType ?? experiment.campaign?.type ?? "official",
    baudRate: Number(els.baud.value) || 115200
  });
}

export function exportExperiment({ readReplicationNumber }) {
  const current = experiment.current ?? experiment.lastCompleted;
  if (!current) {
    els.experimentStatus.textContent = "Nenhum experimento para exportar.";
    return;
  }

  const replicationNumber = current.replicationNumber ?? readReplicationNumber();
  downloadText(
    createDownloadFilename(current, "sensor-data", "csv", replicationNumber, {
      campaignType: current.campaignType
    }),
    createSensorCsv(current),
    "text/csv"
  );
  downloadText(
    createDownloadFilename(current, "metrics", "csv", replicationNumber, {
      campaignType: current.campaignType
    }),
    createMetricsCsv(current),
    "text/csv"
  );
  if (experiment.completedRuns.length) {
    downloadText(
      createDownloadFilename(current, "campaign-summary", "csv", replicationNumber, {
        campaignType: current.campaignType
      }),
      createCampaignSummaryCsv(),
      "text/csv"
    );
  }
  downloadText(
    createDownloadFilename(current, "experiment-summary", "json", replicationNumber, {
      campaignType: current.campaignType
    }),
    JSON.stringify(createSummary(current, { collectExperimentEnvironment, readReplicationNumber }), null, 2),
    "application/json"
  );
  els.experimentStatus.textContent = "Arquivos exportados.";
}
