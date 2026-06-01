
/**
 * Barrel orquestrador do experimento do frontend backend client.
 *
 * Refatorado na Sub-fase 3.3 (622 -> ~25 linhas + 6 modulos coesos):
 *   - experiments/ui-helpers.js          (UI/temporizadores)
 *   - experiments/observation-recorder.js (recordObservedMessage)
 *   - experiments/metrics-builder.js     (CSV de sensor/metrics + helpers)
 *   - experiments/summary-builder.js     (JSON _experiment-summary)
 *   - experiments/exporter.js            (download dos 4 arquivos)
 *   - experiments/lifecycle.js           (start/stop/reset/campaign)
 *
 * API publica preservada (consumida por `app.js` e `dashboard.js`):
 *   startExperiment, startCampaign, stopExperiment, resetExperiment,
 *   exportExperiment, recordObservedMessage.
 */

import {
  collectExperimentEnvironment,
  resetExperiment,
  startCampaign,
  startExperiment,
  stopExperiment
} from "./experiments/lifecycle.js";
import { exportExperiment as exportExperimentInner } from "./experiments/exporter.js";
import { recordObservedMessage } from "./experiments/observation-recorder.js";
import { readReplicationNumber } from "./experiments/ui-helpers.js";

export {
  recordObservedMessage,
  resetExperiment,
  startCampaign,
  startExperiment,
  stopExperiment
};

export async function exportExperiment() {
  return exportExperimentInner({ readReplicationNumber, collectExperimentEnvironment });
}
