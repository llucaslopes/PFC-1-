import { appendLog, els, setStatus } from "./dom.js";
import { resetMetrics } from "./metrics.js";
import { parseAndConsumeLines } from "./parser.js";
import { simulatorState } from "./state.js";

export function startSimulator() {
  if (simulatorState.timer) {
    return;
  }

  resetMetrics();
  els.source.textContent = "Simulador";
  simulatorState.seq = 0;
  const intervalMs = Math.max(10, Number(els.intervalMs.value) || 100);
  simulatorState.timer = setInterval(simTick, intervalMs);
  setStatus(`Simulacao a cada ${intervalMs} ms`, true);
  appendLog(`Simulacao iniciada (${intervalMs} ms).`);
}

export function setSimulatorInterval(intervalMs) {
  if (!simulatorState.timer) {
    return false;
  }

  const nextIntervalMs = Math.max(10, Number(intervalMs) || 100);
  clearInterval(simulatorState.timer);
  simulatorState.timer = setInterval(simTick, nextIntervalMs);
  setStatus(`Simulacao a cada ${nextIntervalMs} ms`, true);
  appendLog(`Intervalo da simulacao atualizado para ${nextIntervalMs} ms.`);
  return true;
}

export function stopSimulator() {
  if (!simulatorState.timer) {
    return;
  }

  clearInterval(simulatorState.timer);
  simulatorState.timer = null;
  appendLog("Simulacao parada.");
  els.source.textContent = "Simulador offline";
  setStatus("Simulacao parada.", true);
}

export function cleanupSimulator() {
  if (simulatorState.timer) {
    clearInterval(simulatorState.timer);
  }
}

function simTick() {
  const send = performance.now();
  simulatorState.seq += 1;
  const hr = 70 + Math.round(15 * Math.sin(send / 2000));
  const ax = 0.02 * Math.sin(send / 300) + (Math.random() - 0.5) * 0.01;
  const ay = 0.02 * Math.cos(send / 400) + (Math.random() - 0.5) * 0.01;
  const az = 1.0 + 0.1 * Math.sin(send / 500) + (Math.random() - 0.5) * 0.02;
  const line = `${simulatorState.seq},${Math.round(send)},${hr},${ax.toFixed(4)},${ay.toFixed(
    4
  )},${az.toFixed(4)}\n`;
  parseAndConsumeLines(line, performance.now());
}
