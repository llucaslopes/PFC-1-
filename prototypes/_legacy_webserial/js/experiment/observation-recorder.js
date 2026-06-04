
/**
 * Recebe samples (validos) e invalid lines do parser.js. So registra se
 * o experimento esta `running`. Extraido de `experiment.js` (Sub-fase 3.4).
 */

import { experiment } from "../state.js";

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
