import { chartContext, elements } from "./dom.js";
import { state } from "./state.js";

export function drawChart() {
  const canvas = elements.chart;
  const width = canvas.width;
  const height = canvas.height;
  const padding = 42;

  chartContext.clearRect(0, 0, width, height);
  chartContext.fillStyle = "#f9fbfa";
  chartContext.fillRect(0, 0, width, height);

  chartContext.strokeStyle = "#dce5df";
  chartContext.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + ((height - padding * 2) / 4) * i;
    chartContext.beginPath();
    chartContext.moveTo(padding, y);
    chartContext.lineTo(width - padding, y);
    chartContext.stroke();
  }

  chartContext.fillStyle = "#617069";
  chartContext.font = "700 13px Inter, system-ui, sans-serif";
  chartContext.fillText("220 bpm", 10, padding + 4);
  chartContext.fillText("70 bpm", 14, height - padding + 4);

  if (state.points.length < 2) {
    chartContext.fillStyle = "#617069";
    chartContext.font = "700 20px Inter, system-ui, sans-serif";
    chartContext.fillText("Aguardando leituras...", padding, height / 2);
    return;
  }

  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const xStep = plotWidth / Math.max(state.points.length - 1, 1);

  chartContext.strokeStyle = "#d63f34";
  chartContext.lineWidth = 4;
  chartContext.lineJoin = "round";
  chartContext.lineCap = "round";
  chartContext.beginPath();

  state.points.forEach((point, index) => {
    const x = padding + xStep * index;
    const normalized = (point.heartRate - 70) / 150;
    const y = height - padding - Math.max(0, Math.min(1, normalized)) * plotHeight;

    if (index === 0) {
      chartContext.moveTo(x, y);
    } else {
      chartContext.lineTo(x, y);
    }
  });

  chartContext.stroke();
}
