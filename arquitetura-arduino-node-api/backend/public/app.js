const state = {
  points: [],
  maxPoints: 48,
  latestMessage: null
};

const elements = {
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
  chart: document.querySelector("#sensorChart")
};

const context = elements.chart.getContext("2d");

function setConnectionStatus(label, mode) {
  elements.connectionStatus.className = `status ${mode}`;
  elements.connectionStatus.querySelector("span:last-child").textContent = label;
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined) {
    return "--";
  }

  return Number(value).toFixed(digits);
}

function applyMessage(message) {
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
  elements.axes.value = `${formatNumber(sensor.acceleration.x, 2)} / ${formatNumber(sensor.acceleration.y, 2)} / ${formatNumber(sensor.acceleration.z, 2)}`;
  elements.messageInfo.textContent = `Mensagem #${sensor.id} recebida ${new Date(message.receivedAt).toLocaleTimeString()}`;

  drawChart();
}

function applyMetrics(metrics) {
  elements.totalMessages.textContent = metrics.totalMessagesReceived;
  elements.invalidMessages.textContent = metrics.totalInvalidMessages;
  elements.lostMessages.textContent = metrics.lostMessages;
  elements.messagesPerSecond.textContent = metrics.messagesPerSecond;
  elements.latency.textContent =
    metrics.lastProcessingLatencyMs === null ? "--" : `${metrics.lastProcessingLatencyMs} ms`;
}

function applyHealth(health) {
  const serial = health.serial;
  const sourceLabel = serial.source === "simulator" ? "Simulador" : serial.configuredPort || "Serial";
  elements.source.textContent = serial.connected ? sourceLabel : `${sourceLabel} offline`;
}

async function refreshSnapshots() {
  try {
    const [healthResponse, metricsResponse, latestResponse] = await Promise.all([
      fetch("/health"),
      fetch("/metrics"),
      fetch("/data/latest")
    ]);

    if (healthResponse.ok) {
      applyHealth(await healthResponse.json());
    }

    if (metricsResponse.ok) {
      applyMetrics(await metricsResponse.json());
    }

    if (latestResponse.ok) {
      applyMessage(await latestResponse.json());
    }
  } catch {
    setConnectionStatus("Backend indisponivel", "offline");
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener("open", () => {
    setConnectionStatus("Tempo real ativo", "online");
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "sensor-data") {
      applyMessage(payload.data);
      refreshMetricsOnly();
    }
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("Reconectando", "offline");
    window.setTimeout(connectWebSocket, 1400);
  });

  socket.addEventListener("error", () => {
    setConnectionStatus("Falha no WebSocket", "offline");
  });
}

async function refreshMetricsOnly() {
  try {
    const [healthResponse, metricsResponse] = await Promise.all([fetch("/health"), fetch("/metrics")]);

    if (healthResponse.ok) {
      applyHealth(await healthResponse.json());
    }

    if (metricsResponse.ok) {
      applyMetrics(await metricsResponse.json());
    }
  } catch {
    setConnectionStatus("Backend indisponivel", "offline");
  }
}

function drawChart() {
  const canvas = elements.chart;
  const width = canvas.width;
  const height = canvas.height;
  const padding = 42;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f9fbfa";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#dce5df";
  context.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding + ((height - padding * 2) / 4) * i;
    context.beginPath();
    context.moveTo(padding, y);
    context.lineTo(width - padding, y);
    context.stroke();
  }

  context.fillStyle = "#617069";
  context.font = "700 13px Inter, system-ui, sans-serif";
  context.fillText("220 bpm", 10, padding + 4);
  context.fillText("70 bpm", 14, height - padding + 4);

  if (state.points.length < 2) {
    context.fillStyle = "#617069";
    context.font = "700 20px Inter, system-ui, sans-serif";
    context.fillText("Aguardando leituras...", padding, height / 2);
    return;
  }

  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const xStep = plotWidth / Math.max(state.points.length - 1, 1);

  context.strokeStyle = "#d63f34";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();

  state.points.forEach((point, index) => {
    const x = padding + xStep * index;
    const normalized = (point.heartRate - 70) / 150;
    const y = height - padding - Math.max(0, Math.min(1, normalized)) * plotHeight;

    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });

  context.stroke();
}

drawChart();
refreshSnapshots();
connectWebSocket();
window.setInterval(refreshMetricsOnly, 3000);
