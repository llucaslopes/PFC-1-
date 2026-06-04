import { refreshMetricsOnly, refreshSnapshots } from "./js/api.js";
import { drawChart } from "./js/chart.js";
import { configureCommunicationMode } from "./js/communication.js";
import { elements } from "./js/dom.js";
import {
  exportExperiment,
  resetExperiment,
  startCampaign,
  startExperiment,
  stopExperiment
} from "./js/experiments.js";
import { state } from "./js/state.js";
import {
  getActiveTarget,
  getTargetProfile,
  setActiveTarget
} from "./js/target.js";

function syncCommunicationModeToTarget() {
  const profile = getTargetProfile();
  if (elements.communicationMode && profile.communicationMode) {
    elements.communicationMode.value = profile.communicationMode;
  }
}

const targetSelector = document.getElementById("targetSelector");
if (targetSelector) {
  targetSelector.value = getActiveTarget();
  targetSelector.addEventListener("change", () => {
    setActiveTarget(targetSelector.value);
    syncCommunicationModeToTarget();
    configureCommunicationMode();
    refreshSnapshots();
  });
}

drawChart();
syncCommunicationModeToTarget();
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
elements.startCampaign.addEventListener("click", startCampaign);
elements.stopExperiment.addEventListener("click", stopExperiment);
elements.resetExperiment.addEventListener("click", resetExperiment);
elements.exportExperiment.addEventListener("click", exportExperiment);
