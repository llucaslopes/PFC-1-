import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

const targetUrl = process.env.TARGET_URL ?? "http://localhost:3000";
const durationSeconds = readPositiveInteger(process.env.DURATION_SECONDS, 30);
const pollIntervalMs = readPositiveInteger(process.env.POLL_INTERVAL_MS, 100);
const clientCounts = readClientCounts(process.env.CLIENT_COUNTS ?? "1,5,10");
const outputFile =
  process.env.OUTPUT_FILE ??
  `scalability-results-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

const scenarios = [
  { mode: "rest-polling", run: runRestPollingScenario },
  { mode: "websocket", run: runWebSocketScenario }
];

const rows = [
  [
    "mode",
    "clients",
    "duration_seconds",
    "poll_interval_ms",
    "total_messages_observed",
    "messages_per_second_total",
    "messages_per_second_per_client",
    "lost_messages_detected",
    "errors",
    "stable_clients"
  ]
];

for (const scenario of scenarios) {
  for (const clients of clientCounts) {
    console.log(
      `[scale] Executando ${scenario.mode} com ${clients} cliente(s) por ${durationSeconds}s.`
    );
    const result = await scenario.run(clients);
    rows.push([
      scenario.mode,
      clients,
      durationSeconds,
      scenario.mode === "rest-polling" ? pollIntervalMs : "",
      result.totalMessages,
      formatNumber(result.totalMessages / durationSeconds),
      formatNumber(result.totalMessages / durationSeconds / clients),
      result.lostMessages,
      result.errors,
      result.stableClients
    ]);
  }
}

const outputPath = path.resolve(process.cwd(), outputFile);
await fs.writeFile(outputPath, toCsv(rows), "utf8");
console.log(`[scale] Resultado salvo em ${outputPath}`);

async function runRestPollingScenario(clients) {
  const states = Array.from({ length: clients }, () => ({
    seen: new Set(),
    lastSeq: null,
    messages: 0,
    lost: 0,
    errors: 0,
    stable: true
  }));

  await Promise.all(
    states.map((state) =>
      repeatForDuration(async () => {
        try {
          const response = await fetch(new URL("/data/latest", targetUrl));

          if (!response.ok) {
            state.errors++;
            state.stable = false;
            return;
          }

          const message = await response.json();
          recordSequence(state, message.sensor.id);
        } catch {
          state.errors++;
          state.stable = false;
        }
      }, pollIntervalMs)
    )
  );

  return summarizeStates(states);
}

async function runWebSocketScenario(clients) {
  const states = Array.from({ length: clients }, () => ({
    seen: new Set(),
    lastSeq: null,
    messages: 0,
    lost: 0,
    errors: 0,
    stable: true
  }));

  await Promise.all(states.map((state) => runWebSocketClient(state)));

  return summarizeStates(states);
}

function runWebSocketClient(state) {
  return new Promise((resolve) => {
    const socket = new WebSocket(toWebSocketUrl(targetUrl));
    const stopTimer = setTimeout(() => {
      socket.close();
      resolve();
    }, durationSeconds * 1000);

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(String(data));

        if (payload.type === "sensor-data") {
          recordSequence(state, payload.data.sensor.id);
        }
      } catch {
        state.errors++;
        state.stable = false;
      }
    });

    socket.on("error", () => {
      state.errors++;
      state.stable = false;
    });

    socket.on("close", () => {
      clearTimeout(stopTimer);
      resolve();
    });
  });
}

function recordSequence(state, seq) {
  if (state.seen.has(seq)) {
    return;
  }

  state.seen.add(seq);
  state.messages++;

  if (state.lastSeq !== null && seq > state.lastSeq + 1) {
    state.lost += seq - state.lastSeq - 1;
  }

  state.lastSeq = seq;
}

function summarizeStates(states) {
  return states.reduce(
    (summary, state) => ({
      totalMessages: summary.totalMessages + state.messages,
      lostMessages: summary.lostMessages + state.lost,
      errors: summary.errors + state.errors,
      stableClients: summary.stableClients + (state.stable ? 1 : 0)
    }),
    { totalMessages: 0, lostMessages: 0, errors: 0, stableClients: 0 }
  );
}

function repeatForDuration(task, intervalMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt >= durationSeconds * 1000) {
        clearInterval(timer);
        resolve();
        return;
      }

      await task();
    }, intervalMs);
  });
}

function toWebSocketUrl(value) {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readClientCounts(value) {
  return value
    .split(",")
    .map((item) => readPositiveInteger(item.trim(), 0))
    .filter((item) => item > 0);
}

function formatNumber(value) {
  return Number(value.toFixed(3));
}

function toCsv(csvRows) {
  return csvRows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value) {
  const text = String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}
