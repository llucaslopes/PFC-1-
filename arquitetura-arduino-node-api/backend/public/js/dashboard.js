import { drawChart } from "./chart.js";
import { elements, formatNumber } from "./dom.js";
import { recordObservedMessage } from "./experiments.js";
import { state } from "./state.js";

export function applyMessage(message) {
  recordObservedMessage(message);
  state.latestMessage = message;
  const sensor = message.sensor;

  state.points.push({
    id: sensor.id,
    heartRate: sensor.heartRate,
    acceleration: sensor.acceleration.magnitude
  });

  if (state.points.length > state.maxPoints) {
    state.points.shift();
  }

  elements.heartRate.value = sensor.heartRate;
  elements.acceleration.value = formatNumber(sensor.acceleration.magnitude, 3);
  elements.axes.value = `${formatNumber(sensor.acceleration.x, 2)} / ${formatNumber(
    sensor.acceleration.y,
    2
  )} / ${formatNumber(sensor.acceleration.z, 2)}`;
  elements.messageInfo.textContent = `Mensagem #${sensor.id} recebida ${new Date(
    message.receivedAt
  ).toLocaleTimeString()}`;

  drawChart();
}

export function applyMetrics(metrics) {
  elements.totalMessages.textContent = metrics.totalMessagesReceived;
  elements.invalidMessages.textContent = metrics.totalInvalidMessages;
  elements.lostMessages.textContent = metrics.lostMessages;
  elements.messagesPerSecond.textContent = formatNumber(metrics.averageMessagesPerSecond, 3);
  if (!state.observedSamples.length) {
    elements.latency.textContent = "--";
  }
  elements.averageLatency.textContent =
    metrics.processingLatencyMs.average === null ? "--" : `${metrics.processingLatencyMs.average} ms`;
  elements.lostPercent.textContent = `${formatNumber(metrics.lostMessagesPercent, 3)}%`;
  elements.invalidPercent.textContent = `${formatNumber(metrics.invalidMessagesPercent, 3)}%`;
}

export function applyHealth(health) {
  const serial = health.serial;
  const sourceLabel = serial.source === "simulator" ? "Simulador" : serial.configuredPort || "Serial";
  elements.source.textContent = serial.connected ? sourceLabel : `${sourceLabel} offline`;
}
