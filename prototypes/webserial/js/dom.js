export const els = {
  status: document.getElementById("status"),
  statusLabel: document.querySelector("#status span:last-child"),
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  simStart: document.getElementById("simStart"),
  simStop: document.getElementById("simStop"),
  experimentStart: document.getElementById("experimentStart"),
  experimentStop: document.getElementById("experimentStop"),
  experimentExport: document.getElementById("experimentExport"),
  intervalMs: document.getElementById("intervalMs"),
  durationSeconds: document.getElementById("durationSeconds"),
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
  averageLatency: document.getElementById("averageLatency"),
  lostPercent: document.getElementById("lostPercent"),
  invalidPercent: document.getElementById("invalidPercent"),
  experimentStatus: document.getElementById("experimentStatus"),
  log: document.getElementById("log")
};

export function setStatus(text, ok = true) {
  els.statusLabel.textContent = text;
  els.status.dataset.ok = String(ok);
  els.status.className = `status ${ok ? "online" : "offline"}`;
}

export function appendLog(msg) {
  const t = new Date().toISOString().slice(11, 23);
  els.log.textContent = `[${t}] ${msg}\n` + els.log.textContent.slice(0, 4000);
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

export function formatSerialSource(selectedPort) {
  const info = selectedPort?.getInfo?.();

  if (info?.usbVendorId || info?.usbProductId) {
    const vendor = info.usbVendorId?.toString(16).padStart(4, "0").toUpperCase() ?? "----";
    const product = info.usbProductId?.toString(16).padStart(4, "0").toUpperCase() ?? "----";
    return `USB ${vendor}:${product}`;
  }

  return "Serial";
}
