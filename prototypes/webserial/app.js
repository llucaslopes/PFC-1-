import { els } from "./js/dom.js";
import {
  exportExperiment,
  startExperiment,
  stopExperiment,
  stopExperimentTimer
} from "./js/experiment.js";
import { connectSerial, disconnectSerial, initializeSerialSupport } from "./js/serial.js";
import { cleanupSimulator, startSimulator, stopSimulator } from "./js/simulator.js";

initializeSerialSupport();

els.connect.addEventListener("click", connectSerial);
els.disconnect.addEventListener("click", disconnectSerial);
els.simStart.addEventListener("click", startSimulator);
els.simStop.addEventListener("click", stopSimulator);
els.experimentStart.addEventListener("click", startExperiment);
els.experimentStop.addEventListener("click", stopExperiment);
els.experimentExport.addEventListener("click", exportExperiment);

window.addEventListener("beforeunload", () => {
  cleanupSimulator();
  stopExperimentTimer();
});
