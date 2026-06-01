
/**
 * Dispara o download dos 4 arquivos do experimento (sensor-data,
 * metrics, campaign-summary, experiment-summary). Extraido de
 * `experiments.js` na Sub-fase 3.3.
 */

import { downloadText, elements } from "../dom.js";
import { createDownloadFilename } from "../scientific.js";
import { state } from "../state.js";

import {
  createCampaignSummaryCsv,
  createMetricsCsv,
  createSensorCsv
} from "./metrics-builder.js";
import { createSummary } from "./summary-builder.js";

export async function exportExperiment({ readReplicationNumber, collectExperimentEnvironment }) {
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
    JSON.stringify(createSummary(experiment, { collectExperimentEnvironment, readReplicationNumber }), null, 2),
    "application/json"
  );
  elements.experimentStatus.textContent = "Arquivos exportados";
}
