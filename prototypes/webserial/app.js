/**
 * WebSerial + simulação de Arduino (mesmo formato de linha CSV).
 * Linha: seq,send_ms,hr,ax,ay,az\n
 * - send_ms: millis() no Arduino; em simulação, Math.round(performance.now()) no "envio".
 */

// send_ms: inteiro (millis Arduino) ou decimal (performance.now na simulação antiga)
const LINE_RE = /^(\d+),(\d+(?:\.\d+)?),(\d+),([-0-9.]+),([-0-9.]+),([-0-9.]+)\r?$/;

const els = {
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status span:last-child"),
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  simStart: document.getElementById("simStart"),
  simStop: document.getElementById("simStop"),
  intervalMs: document.getElementById("intervalMs"),
  baud: document.getElementById("baud"),
  lastLine: document.getElementById("lastLine"),
  hr: document.getElementById("hr"),
  accel: document.getElementById("accel"),
  throughput: document.getElementById("throughput"),
  source: document.getElementById("source"),
  totalMessages: document.getElementById("totalMessages"),
  invalidMessages: document.getElementById("invalidMessages"),
  lostMessages: document.getElementById("lostMessages"),
  messagesPerSecond: document.getElementById("messagesPerSecond"),
  latency: document.getElementById("latency"),
  log: document.getElementById("log"),
};

let port = null;
let reader = null;
let readLoopAbort = false;
let lineBuffer = "";

let simTimer = null;
let simSeq = 0;

/** @type {number|null} */
let lastArrival = null;
/** @type {number|null} */
let lastSeq = null;
let totalMessages = 0;
let invalidMessages = 0;
let lostMessages = 0;
const interArrivals = [];
const MAX_SAMPLES = 500;

function setStatus(text, ok = true) {
  els.statusLabel.textContent = text;
  els.status.dataset.ok = String(ok);
  els.status.className = `status ${ok ? "online" : "offline"}`;
}

function pushInterArrival(now) {
  if (lastArrival != null) {
    const dt = now - lastArrival;
    interArrivals.push(dt);
    if (interArrivals.length > MAX_SAMPLES) interArrivals.shift();
  }
  lastArrival = now;
}

function stats(arr) {
  if (!arr.length) return { mean: 0, std: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / arr.length;
  return { mean, std: Math.sqrt(v) };
}

function resetMetrics() {
  lastArrival = null;
  lastSeq = null;
  totalMessages = 0;
  invalidMessages = 0;
  lostMessages = 0;
  interArrivals.length = 0;
  els.throughput.textContent = "--";
  els.totalMessages.textContent = "0";
  els.invalidMessages.textContent = "0";
  els.lostMessages.textContent = "0";
  els.messagesPerSecond.textContent = "0";
  els.latency.textContent = "--";
}

function formatSerialSource(selectedPort) {
  const info = selectedPort?.getInfo?.();

  if (info?.usbVendorId || info?.usbProductId) {
    const vendor = info.usbVendorId?.toString(16).padStart(4, "0").toUpperCase() ?? "----";
    const product = info.usbProductId?.toString(16).padStart(4, "0").toUpperCase() ?? "----";
    return `USB ${vendor}:${product}`;
  }

  return "Serial";
}

function applySystemMetrics(messagesPerSecond, latencyMs) {
  els.totalMessages.textContent = String(totalMessages);
  els.invalidMessages.textContent = String(invalidMessages);
  els.lostMessages.textContent = String(lostMessages);
  els.messagesPerSecond.textContent = messagesPerSecond.toFixed(3);
  els.latency.textContent = latencyMs === null ? "--" : `${latencyMs.toFixed(3)} ms`;
}

function handleParsedLine(seq, sendMs, hr, ax, ay, az, receiveTime) {
  const processingStartedAt = performance.now();

  pushInterArrival(receiveTime);

  const { mean, std } = stats(interArrivals);
  const thr = interArrivals.length ? 1000 / mean : 0;
  totalMessages += 1;

  if (lastSeq !== null && seq > lastSeq + 1) {
    lostMessages += seq - lastSeq - 1;
  }
  lastSeq = seq;

  els.lastLine.textContent = `${seq},${sendMs},${hr},${ax},${ay},${az}`;
  els.hr.textContent = String(hr);
  els.accel.textContent = `${ax.toFixed(2)}, ${ay.toFixed(2)}, ${az.toFixed(2)}`;
  els.throughput.textContent = thr.toFixed(1);

  const processingLatencyMs = performance.now() - processingStartedAt;
  applySystemMetrics(thr, processingLatencyMs);
}

function parseAndConsumeLines(chunk, receiveTime) {
  lineBuffer += chunk;
  const parts = lineBuffer.split("\n");
  lineBuffer = parts.pop() ?? "";
  for (const raw of parts) {
    const line = raw.replace(/\r$/, "");
    const m = line.match(LINE_RE);
    if (!m) {
      if (line.trim()) {
        invalidMessages += 1;
        els.invalidMessages.textContent = String(invalidMessages);
      }
      continue;
    }
    const [, seq, sendMs, hr, ax, ay, az] = m;
    handleParsedLine(
      Number(seq),
      Number(sendMs),
      Number(hr),
      Number(ax),
      Number(ay),
      Number(az),
      receiveTime
    );
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();
  readLoopAbort = false;
  while (port?.readable && !readLoopAbort) {
    reader = port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) parseAndConsumeLines(decoder.decode(value, { stream: true }), performance.now());
      }
    } catch (e) {
      appendLog(`Erro leitura serial: ${e.message}`);
    } finally {
      reader.releaseLock();
      reader = null;
    }
  }
}

function appendLog(msg) {
  const t = new Date().toISOString().slice(11, 23);
  els.log.textContent = `[${t}] ${msg}\n` + els.log.textContent.slice(0, 4000);
}

if (!("serial" in navigator)) {
  setStatus("Web Serial não disponível neste navegador. Use Chrome/Edge desktop em http://localhost.", false);
  els.connect.disabled = true;
  els.source.textContent = "Indisponivel";
} else {
  setStatus("Pronto para serial ou simulação", true);
  els.source.textContent = "--";
}

els.connect.addEventListener("click", async () => {
  if (!("serial" in navigator)) return;
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: Number(els.baud.value) || 115200 });
    resetMetrics();
    els.source.textContent = formatSerialSource(port);
    setStatus("Serial aberta. Recebendo...", true);
    appendLog(`Aberto a ${els.baud.value} baud`);
    readSerialLoop();
  } catch (e) {
    if (e.name === "NotFoundError") {
      appendLog("Nenhuma porta selecionada.");
    } else {
      appendLog(`Falha ao abrir: ${e.message}`);
      setStatus("Falha ao abrir serial.", false);
    }
  }
});

els.disconnect.addEventListener("click", async () => {
  readLoopAbort = true;
  try {
    if (reader) await reader.cancel();
  } catch (_) {
    /* ignore */
  }
  try {
    if (port) await port.close();
  } catch (e) {
    appendLog(`Fechamento: ${e.message}`);
  }
  port = null;
  els.source.textContent = "Serial offline";
  setStatus("Serial fechada.", true);
  appendLog("Porta fechada.");
});

function simTick() {
  const send = performance.now();
  simSeq += 1;
  const hr = 70 + Math.round(15 * Math.sin(send / 2000));
  const ax = 0.02 * Math.sin(send / 300) + (Math.random() - 0.5) * 0.01;
  const ay = 0.02 * Math.cos(send / 400) + (Math.random() - 0.5) * 0.01;
  const az = 1.0 + 0.1 * Math.sin(send / 500) + (Math.random() - 0.5) * 0.02;
  const line = `${simSeq},${Math.round(send)},${hr},${ax.toFixed(4)},${ay.toFixed(4)},${az.toFixed(4)}\n`;
  parseAndConsumeLines(line, performance.now());
}

els.simStart.addEventListener("click", () => {
  if (simTimer) return;
  resetMetrics();
  els.source.textContent = "Simulador";
  simSeq = 0;
  const ms = Math.max(10, Number(els.intervalMs.value) || 100);
  simTimer = setInterval(simTick, ms);
  setStatus(`Simulação a cada ${ms} ms`, true);
  appendLog(`Simulação iniciada (${ms} ms).`);
});

els.simStop.addEventListener("click", () => {
  if (simTimer) {
    clearInterval(simTimer);
    simTimer = null;
    appendLog("Simulação parada.");
    els.source.textContent = "Simulador offline";
    setStatus("Simulação parada.", true);
  }
});

window.addEventListener("beforeunload", () => {
  if (simTimer) clearInterval(simTimer);
});
