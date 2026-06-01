
/**
 * Barrel orquestrador do experimento do prototipo WebSerial.
 *
 * Refatorado na Sub-fase 3.4 (561 -> ~40 linhas + 6 modulos coesos):
 *   - experiment/ui-helpers.js          (UI/temporizadores)
 *   - experiment/observation-recorder.js (recordExperimentSample/Invalid)
 *   - experiment/metrics-builder.js     (CSV de sensor/metrics + helpers)
 *   - experiment/summary-builder.js     (JSON _experiment-summary)
 *   - experiment/exporter.js            (download dos 4 arquivos + env)
 *   - experiment/lifecycle.js           (start/stop/campaign)
 *
 * API publica preservada (consumida por `app.js` e `parser.js`):
 *   startExperiment, startCampaign, stopExperiment, stopExperimentTimer,
 *   exportExperiment, recordExperimentSample, recordExperimentInvalid.
 */

import {
  exportExperiment as exportExperimentInner
} from "./experiment/exporter.js";
import {
  startCampaign,
  startExperiment,
  stopExperiment,
  stopExperimentTimer
} from "./experiment/lifecycle.js";
import {
  recordExperimentInvalid,
  recordExperimentSample
} from "./experiment/observation-recorder.js";
import { readReplicationNumber } from "./experiment/ui-helpers.js";

export {
  recordExperimentInvalid,
  recordExperimentSample,
  startCampaign,
  startExperiment,
  stopExperiment,
  stopExperimentTimer
};

export function exportExperiment() {
  return exportExperimentInner({ readReplicationNumber });
}
