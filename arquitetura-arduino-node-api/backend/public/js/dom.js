export const elements = {
  connectionStatus: document.querySelector("#connectionStatus"),
  heartRate: document.querySelector("#heartRate"),
  acceleration: document.querySelector("#acceleration"),
  axes: document.querySelector("#axes"),
  messageInfo: document.querySelector("#messageInfo"),
  source: document.querySelector("#source"),
  totalMessages: document.querySelector("#totalMessages"),
  invalidMessages: document.querySelector("#invalidMessages"),
  lostMessages: document.querySelector("#lostMessages"),
  messagesPerSecond: document.querySelector("#messagesPerSecond"),
  latency: document.querySelector("#latency"),
  averageLatency: document.querySelector("#averageLatency"),
  lostPercent: document.querySelector("#lostPercent"),
  invalidPercent: document.querySelector("#invalidPercent"),
  chart: document.querySelector("#sensorChart"),
  communicationMode: document.querySelector("#communicationMode"),
  experimentSource: document.querySelector("#experimentSource"),
  sendIntervalMs: document.querySelector("#sendIntervalMs"),
  durationSeconds: document.querySelector("#durationSeconds"),
  startExperiment: document.querySelector("#startExperiment"),
  stopExperiment: document.querySelector("#stopExperiment"),
  resetExperiment: document.querySelector("#resetExperiment"),
  exportExperiment: document.querySelector("#exportExperiment"),
  experimentStatus: document.querySelector("#experimentStatus")
};

export const chartContext = elements.chart.getContext("2d");

export function setConnectionStatus(label, mode) {
  elements.connectionStatus.className = `status ${mode}`;
  elements.connectionStatus.querySelector("span:last-child").textContent = label;
}

export function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

export function downloadText(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
