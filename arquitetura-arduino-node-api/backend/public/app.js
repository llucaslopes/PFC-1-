import { refreshMetricsOnly, refreshSnapshots } from "./js/api.js";
import { drawChart } from "./js/chart.js";
import { configureCommunicationMode } from "./js/communication.js";
import { elements } from "./js/dom.js";
import {
  exportExperiment,
  resetExperiment,
  startExperiment,
  stopExperiment
} from "./js/experiments.js";
import { state } from "./js/state.js";

drawChart();
refreshSnapshots();
configureCommunicationMode();
state.metricsTimer = window.setInterval(refreshMetricsOnly, 3000);

elements.communicationMode.addEventListener("change", configureCommunicationMode);
elements.sendIntervalMs.addEventListener("change", () => {
  if (elements.communicationMode.value === "rest-polling") {
    configureCommunicationMode();
  }
});
elements.startExperiment.addEventListener("click", startExperiment);
elements.stopExperiment.addEventListener("click", stopExperiment);
elements.resetExperiment.addEventListener("click", resetExperiment);
elements.exportExperiment.addEventListener("click", exportExperiment);
