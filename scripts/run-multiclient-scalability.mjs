#!/usr/bin/env node
/**
 * Campanha de escalabilidade horizontal: multiplos clientes simultaneos.
 *
 * Para cada combinacao (modo, intervalo do produtor, numero de clientes,
 * repeticao), inicia o backend, sobe N clientes paralelos (WebSocket ou
 * REST polling), coleta CPU/RAM via /health/process e mede latencia por
 * cliente usando o mesmo sync NTP/Cristian da campanha principal.
 *
 * Saidas em resultados/escalabilidade-clientes-2026-05/.
 *
 * NAO modifica resultados existentes nem outras campanhas.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WebSocket } from "ws";

import {
  computeEndToEndLatency,
  remoteSendToHostMs
} from "./lib/clockSyncMath.mjs";
import {
  createRelativeFallbackClockSync,
  mergeClockSync,
  synchronizeBackendClock
} from "./lib/clock-sync.mjs";
import { startKeepAwake } from "./lib/keep-awake.mjs";
import { initLogFile } from "./lib/runtime-utils.mjs";
import { resolveSerialPort } from "./lib/serial-detect.mjs";
import { startBackend, startWebserial, stop } from "./lib/server-control.mjs";
import {
  bootstrapSerialPermission,
  hasSerialPermission,
  runWebserialCampaign
} from "./lib/webserial-runner.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CAMPAIGN = {
  type: "scalability-clients",
  name: "escalabilidade-clientes-2026-05",
  intervalsMs: [100, 50, 20, 10, 5],
  clientCounts: [1, 2, 5, 10, 20],
  modes: ["websocket", "rest-polling", "webserial"],
  defaultReps: 3,
  defaultDurationSeconds: 60,
  resourceSampleIntervalMs: 500,
  // WebSerial e single-client por design (Web Serial API e exclusiva por porta).
  // Na campanha multi-cliente ele entra apenas em N=1 para servir de baseline
  // arquitetural lado a lado com WS/REST nesse mesmo numero de clientes.
  webserialClientCount: 1
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

function parseList(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntList(value, fallback) {
  const parts = parseList(value, fallback.map(String));
  return parts
    .map((p) => Number(p))
    .filter((p) => Number.isFinite(p) && p > 0);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Uso: node scripts/run-multiclient-scalability.mjs [opcoes]

Mede escalabilidade horizontal (multiplos clientes simultaneos) para WebSocket
e REST polling. WebSerial tambem pode ser incluido, mas APENAS em N=1 cliente
(restricao arquitetural: a Web Serial API e exclusiva por porta serial; rodar
N>1 navegadores conectados a uma unica porta e impossivel sem replicar o
hardware). Quando 'webserial' esta entre os modos, qualquer --clients diferente
de 1 e ignorado para esse modo (usado N=1 fixo) e o backend Node nao roda.

Matriz default:
  modes              websocket, rest-polling, webserial
  intervals (ms)     100, 50, 20, 10, 5
  clients            1, 2, 5, 10, 20  (webserial usa apenas 1)
  reps               3
  duration           60 s
  total              5 x 5 x 3 x 2 (WS+REST) + 5 x 1 x 3 (webserial) = 165 execucoes

Opcoes:
  --source serial|simulator     fonte das amostras (default: serial)
  --serial-port COM3|auto       porta do Arduino (default: auto)
  --reps 3                      repeticoes (default: 3)
  --duration 60                 segundos por execucao (default: 60)
  --intervals 100,50,20,10,5    sobrescreve a matriz de intervalos
  --clients 1,2,5,10,20         sobrescreve a matriz de clientes (webserial sempre 1)
  --modes websocket,rest-polling,webserial
                                modos a testar (default: todos)
  --campaign-dir <path>         destino dos arquivos
  --port-backend 3000           porta do backend (WS/REST)
  --port-webserial 8765         porta do servidor estatico do prototipo WebSerial
  --chromium-user-data <path>   perfil persistente do Playwright/Chromium
  --no-auto-bootstrap           nao autoriza a porta serial automaticamente
  --bootstrap-webserial         abre o Chrome para autorizar a porta serial e sai
  --log-file logs/multiclient.log
  --no-resume                   refaz execucoes ja completas
  --no-keep-awake               nao impede o Windows de dormir
  --skip-analysis               nao roda plot_multiclient.py
  --help

Exemplos:
  npm run experiment:multiclient
  node scripts/run-multiclient-scalability.mjs --serial-port COM3
  node scripts/run-multiclient-scalability.mjs --modes websocket --clients 1,5,10
  node scripts/run-multiclient-scalability.mjs --modes webserial --intervals 100
  node scripts/run-multiclient-scalability.mjs --source simulator --reps 1     # sanity
`);
}

function nowIsoForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function quantile(sortedArray, q) {
  if (!sortedArray.length) return null;
  const pos = (sortedArray.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedArray[base + 1];
  return next !== undefined
    ? sortedArray[base] + rest * (next - sortedArray[base])
    : sortedArray[base];
}

function summarizeNumeric(values) {
  if (!values.length) {
    return {
      samples: 0,
      avg: null,
      median: null,
      min: null,
      max: null,
      std: null,
      p95: null,
      p99: null
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const avg = sum / sorted.length;
  const variance =
    sorted.reduce((acc, v) => acc + (v - avg) ** 2, 0) / sorted.length;
  return {
    samples: sorted.length,
    avg,
    median: quantile(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    std: Math.sqrt(variance),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99)
  };
}

function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(digits));
}

function toWsUrl(httpUrl) {
  const u = new URL(httpUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

async function startExperiment({ baseUrl, payload }) {
  const response = await fetch(`${baseUrl}/experiments/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`POST /experiments/start: ${response.status} ${text}`);
  }
  return response.json();
}

async function stopExperiment(baseUrl) {
  try {
    await fetch(`${baseUrl}/experiments/stop`, {
      method: "POST",
      cache: "no-store"
    });
  } catch {
    // ignore
  }
}

async function resetExperiment(baseUrl) {
  try {
    await fetch(`${baseUrl}/experiments/reset`, {
      method: "POST",
      cache: "no-store"
    });
  } catch {
    // ignore
  }
}

/**
 * Cliente WebSocket que escuta sensor-data e registra latencia por amostra.
 * Cada cliente desta campanha e independente: abre seu proprio socket, mantem
 * seu proprio estado de seq/perda, e calcula latencia usando o offset
 * Arduino->frontend ja resolvido (clockSync mesclado).
 */
function runWebSocketClient({ baseUrl, durationMs, clockSync, clientId }) {
  return new Promise((resolveClient) => {
    const wsUrl = toWsUrl(baseUrl);
    const socket = new WebSocket(wsUrl);
    const samples = [];
    const seenSeq = new Set();
    let messages = 0;
    let lost = 0;
    let lastSeq = null;
    let firstReceiveMs = null;
    let lastReceiveMs = null;
    let errors = 0;
    let stopped = false;
    let stopTimer = null;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      if (stopTimer) clearTimeout(stopTimer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      resolveClient({
        clientId,
        mode: "websocket",
        messagesReceived: messages,
        uniqueSeqs: seenSeq.size,
        seqGapLost: lost,
        errors,
        firstReceiveMs,
        lastReceiveMs,
        samples
      });
    };

    socket.on("open", () => {
      stopTimer = setTimeout(finish, durationMs);
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(String(data));
        if (payload.type !== "sensor-data") return;
        const message = payload.data;
        if (!message?.sensor) return;

        const receiveMs = performance.now();
        const seq = Number(message.sensor.id);
        if (!Number.isFinite(seq)) return;

        if (seenSeq.has(seq)) return;
        seenSeq.add(seq);
        messages++;
        if (firstReceiveMs === null) firstReceiveMs = receiveMs;
        lastReceiveMs = receiveMs;

        if (lastSeq !== null && seq > lastSeq + 1) {
          lost += seq - lastSeq - 1;
        }
        lastSeq = seq;

        const offsetMs =
          clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs ?? null;
        const rawSendBackend = message.estimatedBackendSendTimeMs;
        const sendBackendMs =
          rawSendBackend === null || rawSendBackend === undefined
            ? null
            : Number(rawSendBackend);
        // Calcula latencia se temos: (i) offset valido cliente<->backend
        // (sync deste orquestrador) e (ii) estimatedBackendSendTimeMs
        // realmente preenchido pelo backend (nao null - o backend devolve
        // null quando nao tem sync com Arduino, ex.: source=simulator).
        const hasSync =
          Number.isFinite(offsetMs) &&
          sendBackendMs !== null &&
          Number.isFinite(sendBackendMs);
        const latencyMs = hasSync
          ? computeEndToEndLatency(receiveMs, sendBackendMs, "ms", offsetMs)
          : null;

        samples.push({
          seq,
          receiveMs,
          estimatedFrontendSendMs: hasSync ? remoteSendToHostMs(sendBackendMs, "ms", offsetMs) : null,
          latencyMs
        });
      } catch {
        errors++;
      }
    });

    socket.on("error", () => {
      errors++;
    });
    socket.on("close", () => finish());
  });
}

/**
 * Cliente REST polling: faz fetch /data/latest a cada intervalMs.
 * Mantem deduplicacao por seq para nao contar a mesma amostra duas vezes.
 */
function runRestPollingClient({
  baseUrl,
  durationMs,
  pollIntervalMs,
  clockSync,
  clientId
}) {
  return new Promise((resolveClient) => {
    const samples = [];
    const seenSeq = new Set();
    let messages = 0;
    let lost = 0;
    let lastSeq = null;
    let firstReceiveMs = null;
    let lastReceiveMs = null;
    let errors = 0;
    let stopped = false;
    let inflight = false;
    const startedAt = performance.now();

    const offsetMs =
      clockSync?.backendToFrontendOffsetMs ?? clockSync?.frontendBackendOffsetMs ?? null;
    const hasSyncOffset = Number.isFinite(offsetMs);

    const tick = async () => {
      if (stopped || inflight) return;
      inflight = true;
      try {
        const response = await fetch(`${baseUrl}/data/latest`, { cache: "no-store" });
        if (!response.ok) {
          if (response.status !== 404) errors++;
          return;
        }
        const message = await response.json();
        if (!message?.sensor) return;

        const receiveMs = performance.now();
        const seq = Number(message.sensor.id);
        if (!Number.isFinite(seq)) return;
        if (seenSeq.has(seq)) return;

        seenSeq.add(seq);
        messages++;
        if (firstReceiveMs === null) firstReceiveMs = receiveMs;
        lastReceiveMs = receiveMs;

        if (lastSeq !== null && seq > lastSeq + 1) {
          lost += seq - lastSeq - 1;
        }
        lastSeq = seq;

        const sendBackendMsRaw = message.estimatedBackendSendTimeMs;
        const sendBackendMs =
          sendBackendMsRaw === null || sendBackendMsRaw === undefined
            ? null
            : Number(sendBackendMsRaw);
        const hasSync =
          hasSyncOffset && sendBackendMs !== null && Number.isFinite(sendBackendMs);
        const latencyMs = hasSync
          ? computeEndToEndLatency(receiveMs, sendBackendMs, "ms", offsetMs)
          : null;

        samples.push({
          seq,
          receiveMs,
          estimatedFrontendSendMs: hasSync ? remoteSendToHostMs(sendBackendMs, "ms", offsetMs) : null,
          latencyMs
        });
      } catch {
        errors++;
      } finally {
        inflight = false;
      }
    };

    const timer = setInterval(() => {
      if (performance.now() - startedAt >= durationMs) {
        stopped = true;
        clearInterval(timer);
        resolveClient({
          clientId,
          mode: "rest-polling",
          messagesReceived: messages,
          uniqueSeqs: seenSeq.size,
          seqGapLost: lost,
          errors,
          firstReceiveMs,
          lastReceiveMs,
          samples
        });
        return;
      }
      void tick();
    }, pollIntervalMs);
  });
}

function startResourceSampler({ baseUrl, intervalMs }) {
  const samples = [];
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const response = await fetch(`${baseUrl}/health/process`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      samples.push({
        sampledAt: payload.sampledAt,
        backendNowMs: payload.backendNowMs,
        cpuUsagePercent: payload.cpu?.usagePercent ?? null,
        cpuUserMs: payload.cpu?.deltaUserMs ?? null,
        cpuSystemMs: payload.cpu?.deltaSystemMs ?? null,
        memRssMb: payload.memory?.rssMb ?? null,
        memHeapUsedMb: payload.memory?.heapUsedMb ?? null,
        memHeapTotalMb: payload.memory?.heapTotalMb ?? null,
        websocketClients: payload.websocketClients ?? null
      });
    } catch {
      // ignore
    }
  };

  // descarta a primeira leitura para resetar o delta de CPU sem poluir a serie
  void fetch(`${baseUrl}/health/process`, { cache: "no-store" }).catch(() => {});

  const timer = setInterval(() => void tick(), intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    getSamples() {
      return samples;
    }
  };
}

function summarizeResources(samples) {
  if (!samples.length) {
    return {
      samples: 0,
      cpuUsagePercent: summarizeNumeric([]),
      memRssMb: summarizeNumeric([]),
      memHeapUsedMb: summarizeNumeric([])
    };
  }
  return {
    samples: samples.length,
    cpuUsagePercent: summarizeNumeric(
      samples
        .map((s) => s.cpuUsagePercent)
        .filter((v) => Number.isFinite(v))
    ),
    memRssMb: summarizeNumeric(
      samples.map((s) => s.memRssMb).filter((v) => Number.isFinite(v))
    ),
    memHeapUsedMb: summarizeNumeric(
      samples.map((s) => s.memHeapUsedMb).filter((v) => Number.isFinite(v))
    )
  };
}

function fileBase({ mode, intervalMs, clientCount, rep, timestamp }) {
  return `${mode}_${intervalMs}ms_${clientCount}cli_rep${rep}_${timestamp}_${CAMPAIGN.type}`;
}

function isAlreadyComplete({ campaignDir, mode, intervalMs, clientCount, rep }) {
  let entries;
  try {
    entries = readdirSync(campaignDir);
  } catch {
    return false;
  }
  const prefix = `${mode}_${intervalMs}ms_${clientCount}cli_rep${rep}_`;
  const suffix = `_${CAMPAIGN.type}_aggregate.json`;
  return entries.some((name) => name.startsWith(prefix) && name.endsWith(suffix));
}

function summarizePerClient(clientResults, durationSeconds) {
  return clientResults.map((result) => {
    const latencies = result.samples
      .map((s) => s.latencyMs)
      .filter((v) => Number.isFinite(v) && v >= 0);
    const latencyStats = summarizeNumeric(latencies);

    return {
      clientId: result.clientId,
      mode: result.mode,
      messagesReceived: result.messagesReceived,
      uniqueSeqs: result.uniqueSeqs,
      seqGapLost: result.seqGapLost,
      errors: result.errors,
      throughputMessagesPerSecond: round(result.messagesReceived / durationSeconds, 3),
      latencySamples: latencyStats.samples,
      latencyAvgMs: round(latencyStats.avg),
      latencyMedianMs: round(latencyStats.median),
      latencyMinMs: round(latencyStats.min),
      latencyMaxMs: round(latencyStats.max),
      latencyStdMs: round(latencyStats.std),
      latencyP95Ms: round(latencyStats.p95),
      latencyP99Ms: round(latencyStats.p99)
    };
  });
}

function summarizeAggregate({ perClient, expectedMessages }) {
  const messagesTotal = perClient.reduce((acc, c) => acc + c.messagesReceived, 0);
  const uniqueAcrossClients = new Set();
  // (uniqueAcrossClients precisaria das samples cruas; e calculado abaixo
  //  via overall throughput. mantem placeholder para clareza)

  const throughputAggregate = perClient.reduce(
    (acc, c) => acc + (c.throughputMessagesPerSecond ?? 0),
    0
  );
  const throughputPerClient = perClient.map((c) => c.throughputMessagesPerSecond ?? 0);
  const throughputStats = summarizeNumeric(throughputPerClient);

  const latencyP95Worst = perClient
    .map((c) => c.latencyP95Ms)
    .filter((v) => Number.isFinite(v));
  const latencyP95WorstClient = latencyP95Worst.length ? Math.max(...latencyP95Worst) : null;

  const latencyAvgMean = perClient
    .map((c) => c.latencyAvgMs)
    .filter((v) => Number.isFinite(v));
  const latencyAvgAcross = latencyAvgMean.length
    ? latencyAvgMean.reduce((acc, v) => acc + v, 0) / latencyAvgMean.length
    : null;

  const cv =
    throughputStats.avg && throughputStats.avg > 0 && Number.isFinite(throughputStats.std)
      ? throughputStats.std / throughputStats.avg
      : null;

  return {
    messagesTotalAcrossClients: messagesTotal,
    expectedMessagesPerClient: expectedMessages,
    throughputAggregateMessagesPerSecond: round(throughputAggregate, 3),
    throughputAvgPerClient: round(throughputStats.avg, 3),
    throughputStdPerClient: round(throughputStats.std, 3),
    throughputMinPerClient: round(throughputStats.min, 3),
    throughputMaxPerClient: round(throughputStats.max, 3),
    fairnessCoefficientOfVariation: round(cv, 4),
    latencyAvgMeanAcrossClients: round(latencyAvgAcross),
    latencyP95WorstClientMs: round(latencyP95WorstClient),
    uniqueAcrossClients: uniqueAcrossClients.size || null
  };
}

async function runOneExecution({
  baseUrl,
  campaignDir,
  mode,
  intervalMs,
  clientCount,
  rep,
  durationSeconds,
  source,
  resume
}) {
  const timestamp = nowIsoForFile();
  if (resume && isAlreadyComplete({ campaignDir, mode, intervalMs, clientCount, rep })) {
    console.log(
      `[multiclient]   ${mode} interval=${intervalMs}ms clients=${clientCount} rep=${rep}: ja completa, pulando.`
    );
    return null;
  }

  console.log(
    `[multiclient]   ==> ${mode} interval=${intervalMs}ms clients=${clientCount} rep=${rep} (${durationSeconds}s)`
  );

  await stopExperiment(baseUrl);
  await resetExperiment(baseUrl);

  const frontendBackendSync = await synchronizeBackendClock(baseUrl);
  const startPayload = {
    architecture: "backend-node",
    source,
    communicationMode: mode,
    sendIntervalMs: intervalMs,
    durationSeconds,
    replicationNumber: rep,
    campaignType: CAMPAIGN.type
  };

  const experimentResponse = await startExperiment({ baseUrl, payload: startPayload });
  const mergedClockSync = mergeClockSync(
    experimentResponse.clockSync ?? createRelativeFallbackClockSync("backend_arduino_sync_missing", 0),
    frontendBackendSync
  );

  const sampler = startResourceSampler({
    baseUrl,
    intervalMs: CAMPAIGN.resourceSampleIntervalMs
  });

  const startedRunAt = performance.now();
  const durationMs = durationSeconds * 1000;

  const clientPromises = [];
  for (let i = 0; i < clientCount; i++) {
    if (mode === "websocket") {
      clientPromises.push(
        runWebSocketClient({
          baseUrl,
          durationMs,
          clockSync: mergedClockSync,
          clientId: i + 1
        })
      );
    } else {
      clientPromises.push(
        runRestPollingClient({
          baseUrl,
          durationMs,
          pollIntervalMs: intervalMs,
          clockSync: mergedClockSync,
          clientId: i + 1
        })
      );
    }
  }

  const clientResults = await Promise.all(clientPromises);
  sampler.stop();
  await stopExperiment(baseUrl);

  const elapsedMs = performance.now() - startedRunAt;
  const expectedPerClient = Math.floor(durationMs / intervalMs);

  const perClient = summarizePerClient(clientResults, durationSeconds);
  const aggregate = summarizeAggregate({ perClient, expectedMessages: expectedPerClient });
  const resourceSamples = sampler.getSamples();
  const resourceStats = summarizeResources(resourceSamples);

  const base = fileBase({ mode, intervalMs, clientCount, rep, timestamp });

  const arduinoSyncOk =
    Number.isFinite(mergedClockSync?.arduinoToBackendOffsetMs ?? mergedClockSync?.arduinoHostOffsetMs);
  const clientSyncOk = Number.isFinite(
    mergedClockSync?.backendToFrontendOffsetMs ?? mergedClockSync?.frontendBackendOffsetMs
  );
  const totalLatencySamples = perClient.reduce((acc, c) => acc + (c.latencySamples ?? 0), 0);
  const latencyMethodLabel = totalLatencySamples === 0
    ? "relative_offset_fallback"
    : arduinoSyncOk && clientSyncOk
      ? "ntp_style_clock_synchronization"
      : clientSyncOk
        ? "ntp_style_clock_synchronization_backend_to_client_only"
        : "relative_offset_fallback";

  const aggregateJson = {
    campaign: {
      type: CAMPAIGN.type,
      name: CAMPAIGN.name,
      startedAt: experimentResponse.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      elapsedMs: round(elapsedMs)
    },
    config: {
      mode,
      intervalMs,
      clientCount,
      replication: rep,
      durationSeconds,
      source,
      pollIntervalMs: mode === "rest-polling" ? intervalMs : null,
      resourceSampleIntervalMs: CAMPAIGN.resourceSampleIntervalMs
    },
    clockSync: mergedClockSync,
    aggregate: {
      ...aggregate,
      latencyMethod: latencyMethodLabel
    },
    perClient,
    resources: {
      sampleCount: resourceStats.samples,
      cpuUsagePercent: {
        avg: round(resourceStats.cpuUsagePercent.avg),
        median: round(resourceStats.cpuUsagePercent.median),
        max: round(resourceStats.cpuUsagePercent.max),
        p95: round(resourceStats.cpuUsagePercent.p95)
      },
      memRssMb: {
        avg: round(resourceStats.memRssMb.avg),
        max: round(resourceStats.memRssMb.max)
      },
      memHeapUsedMb: {
        avg: round(resourceStats.memHeapUsedMb.avg),
        max: round(resourceStats.memHeapUsedMb.max)
      }
    },
    notes: {
      latencyDefinition:
        "latencia = receiveMs_cliente - (estimatedBackendSendTimeMs + offsetBackendCliente). Estimativa, nao medicao fisica.",
      fairnessDefinition:
        "fairnessCoefficientOfVariation = std(throughput por cliente) / avg(throughput por cliente). 0 = perfeitamente justo; 1+ = forte assimetria.",
      webserialNote:
        "WebSerial nao esta nesta campanha porque a Web Serial API e exclusiva por porta serial (single-client por design).",
      restPollingNote:
        "Em REST polling com multiplos clientes, todos os clientes competem pela mesma amostra mais recente; mensagens unicas tendem a ser distribuidas, nao replicadas."
    }
  };

  writeFileSync(
    join(campaignDir, `${base}_aggregate.json`),
    JSON.stringify(aggregateJson, null, 2),
    "utf8"
  );

  // CSV per-client (uma linha por cliente)
  const perClientHeader = [
    "mode",
    "interval_ms",
    "client_count",
    "client_id",
    "replication",
    "duration_seconds",
    "messages_received",
    "unique_seqs",
    "seq_gap_lost",
    "errors",
    "throughput_messages_per_second",
    "latency_samples",
    "latency_avg_ms",
    "latency_median_ms",
    "latency_min_ms",
    "latency_max_ms",
    "latency_std_ms",
    "latency_p95_ms",
    "latency_p99_ms"
  ];
  const perClientRows = [perClientHeader];
  for (const c of perClient) {
    perClientRows.push([
      mode,
      intervalMs,
      clientCount,
      c.clientId,
      rep,
      durationSeconds,
      c.messagesReceived,
      c.uniqueSeqs,
      c.seqGapLost,
      c.errors,
      c.throughputMessagesPerSecond,
      c.latencySamples,
      c.latencyAvgMs,
      c.latencyMedianMs,
      c.latencyMinMs,
      c.latencyMaxMs,
      c.latencyStdMs,
      c.latencyP95Ms,
      c.latencyP99Ms
    ]);
  }
  writeFileSync(join(campaignDir, `${base}_per-client.csv`), rowsToCsv(perClientRows), "utf8");

  // CSV de recursos (uma linha por sample)
  const resourceHeader = [
    "sample_index",
    "sampled_at",
    "backend_now_ms",
    "cpu_usage_percent",
    "cpu_user_ms",
    "cpu_system_ms",
    "mem_rss_mb",
    "mem_heap_used_mb",
    "mem_heap_total_mb",
    "websocket_clients"
  ];
  const resourceRows = [resourceHeader];
  resourceSamples.forEach((s, idx) => {
    resourceRows.push([
      idx,
      s.sampledAt,
      s.backendNowMs,
      s.cpuUsagePercent,
      s.cpuUserMs,
      s.cpuSystemMs,
      s.memRssMb,
      s.memHeapUsedMb,
      s.memHeapTotalMb,
      s.websocketClients
    ]);
  });
  writeFileSync(join(campaignDir, `${base}_resources.csv`), rowsToCsv(resourceRows), "utf8");

  console.log(
    `[multiclient]      OK: thruAggr=${round(aggregate.throughputAggregateMessagesPerSecond, 1)} msg/s ` +
      `lat_p95_worst=${aggregate.latencyP95WorstClientMs ?? "-"}ms ` +
      `cpuAvg=${round(resourceStats.cpuUsagePercent.avg, 1) ?? "-"}% ` +
      `memAvg=${round(resourceStats.memRssMb.avg, 1) ?? "-"}MB`
  );

  return aggregateJson;
}

/**
 * Converte um experiment-summary.json gerado pela pagina WebSerial em uma
 * lista de aggregate.json (um por intervalMs presente em summary.runs[]).
 *
 * O runner WebSerial (run-scalability-campaign + scripts/lib/webserial-runner.mjs)
 * grava UM summary por replicacao, e o summary contem todos os intervalos da
 * campanha em summary.runs[]. Esta funcao splita esses runs em arquivos
 * individuais com o mesmo formato `{prefix}_aggregate.json` da campanha
 * multi-cliente, viabilizando o cruzamento WebSerial x WS x REST em N=1.
 */
function convertWebserialSummaryToAggregates({
  summaryFile,
  campaignDir,
  source,
  durationSeconds,
  allowedIntervalsMs
}) {
  const summaryPath = join(campaignDir, summaryFile);
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch (error) {
    console.warn(
      `[multiclient] Falha lendo ${summaryFile}: ${error.message}. Pulando.`
    );
    return [];
  }

  const runs = Array.isArray(summary.runs) ? summary.runs : [];
  if (runs.length === 0) {
    console.warn(
      `[multiclient] ${summaryFile} nao contem runs[]. Pulando conversao.`
    );
    return [];
  }

  // Em modo simulator, a pagina WebSerial nao tem como sincronizar relogio com
  // um Arduino que nao existe e cai num fallback relativo (Date.now epoch vs
  // performance.now). Os numeros reportados nesse caso nao sao latencia real
  // — tipicamente sao da ordem de centenas de milhares de ms. Para nao
  // contaminar os agregados comparativos, qualquer run com tipo declarado
  // como `relative_fallback` (ou metodo equivalente) tem latencia neutralizada
  // (null) no aggregate multi-cliente. Throughput/perdas continuam validos.
  const isFallbackLatency = (run) => {
    const type = String(run?.latencyType ?? "").toLowerCase();
    const method = String(run?.latencyMethod ?? run?.latencyEstimationMethod ?? "").toLowerCase();
    if (type.includes("relative_fallback")) return true;
    if (method.includes("relative_offset")) return true;
    if (method.includes("relative_fallback")) return true;
    if (run?.clockSync?.syncFailed === true) return true;
    return false;
  };

  const repNumber =
    Number(summary.replicationNumber) || Number(summary.campaign?.replicationNumber) || 1;
  const generatedAggregates = [];

  for (const run of runs) {
    const intervalMs = Number(run.intervalMs);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) continue;
    if (allowedIntervalsMs && !allowedIntervalsMs.includes(intervalMs)) continue;

    const messagesReceived = Number(run.receivedMessages) || 0;
    const expectedPerClient =
      Number(run.expectedMessages) || Math.floor((durationSeconds * 1000) / intervalMs);
    const throughput = Number.isFinite(Number(run.messagesPerSecond))
      ? Number(run.messagesPerSecond)
      : round(messagesReceived / durationSeconds, 3);

    const latencyValid = !isFallbackLatency(run);
    const latencyMethodLabel = latencyValid
      ? run.latencyMethod || run.latencyEstimationMethod || "ntp_style_clock_synchronization"
      : "relative_offset_fallback";

    const perClient = [
      {
        clientId: 1,
        mode: "webserial",
        messagesReceived,
        uniqueSeqs: messagesReceived,
        seqGapLost: Number(run.lostMessages) || 0,
        errors: Number(run.invalidMessages) || 0,
        throughputMessagesPerSecond: round(throughput, 3),
        latencySamples: latencyValid ? Number(run.estimatedLatencySamples) || 0 : 0,
        latencyAvgMs: latencyValid ? round(run.estimatedLatencyAverageMs) : null,
        latencyMedianMs: null,
        latencyMinMs: latencyValid ? round(run.estimatedLatencyMinMs) : null,
        latencyMaxMs: latencyValid ? round(run.estimatedLatencyMaxMs) : null,
        latencyStdMs: latencyValid ? round(run.estimatedLatencyStdDevMs) : null,
        latencyP95Ms: latencyValid ? round(run.estimatedLatencyP95Ms) : null,
        latencyP99Ms: null
      }
    ];

    const aggregate = {
      messagesTotalAcrossClients: messagesReceived,
      expectedMessagesPerClient: expectedPerClient,
      throughputAggregateMessagesPerSecond: round(throughput, 3),
      throughputAvgPerClient: round(throughput, 3),
      throughputStdPerClient: 0,
      throughputMinPerClient: round(throughput, 3),
      throughputMaxPerClient: round(throughput, 3),
      fairnessCoefficientOfVariation: 0,
      latencyAvgMeanAcrossClients: latencyValid ? round(run.estimatedLatencyAverageMs) : null,
      latencyP95WorstClientMs: latencyValid ? round(run.estimatedLatencyP95Ms) : null,
      uniqueAcrossClients: null,
      latencyMethod: latencyMethodLabel
    };

    const timestamp = nowIsoForFile();
    const base = fileBase({
      mode: "webserial",
      intervalMs,
      clientCount: CAMPAIGN.webserialClientCount,
      rep: repNumber,
      timestamp
    });

    const aggregateJson = {
      campaign: {
        type: CAMPAIGN.type,
        name: CAMPAIGN.name,
        startedAt: run.startedAt ?? summary.campaign?.startedAt ?? new Date().toISOString(),
        finishedAt: run.stoppedAt ?? summary.campaign?.stoppedAt ?? new Date().toISOString(),
        elapsedMs: round(durationSeconds * 1000)
      },
      config: {
        mode: "webserial",
        intervalMs,
        clientCount: CAMPAIGN.webserialClientCount,
        replication: repNumber,
        durationSeconds,
        source,
        pollIntervalMs: null,
        resourceSampleIntervalMs: null
      },
      clockSync: run.clockSync ?? summary.clockSync ?? null,
      aggregate,
      perClient,
      resources: {
        sampleCount: 0,
        cpuUsagePercent: { avg: null, median: null, max: null, p95: null },
        memRssMb: { avg: null, max: null },
        memHeapUsedMb: { avg: null, max: null }
      },
      notes: {
        latencyDefinition:
          "WebSerial: latencia = receiveMs_navegador - estimatedFrontendSendMs (sync direto Arduino->frontend, sem backend intermediario).",
        fairnessDefinition:
          "Nao se aplica em WebSerial: arquitetura e single-client por design da Web Serial API.",
        webserialNote:
          "WebSerial entra na campanha multi-cliente apenas em N=1 (limite arquitetural maximo). Backend Node.js nao participa, portanto recursos CPU/RAM nao sao monitoraveis nesta arquitetura.",
        webserialSource: `Derivado de ${summaryFile} (run intervalMs=${intervalMs}ms).`
      }
    };

    writeFileSync(
      join(campaignDir, `${base}_aggregate.json`),
      JSON.stringify(aggregateJson, null, 2),
      "utf8"
    );

    const perClientHeader = [
      "mode",
      "interval_ms",
      "client_count",
      "client_id",
      "replication",
      "duration_seconds",
      "messages_received",
      "unique_seqs",
      "seq_gap_lost",
      "errors",
      "throughput_messages_per_second",
      "latency_samples",
      "latency_avg_ms",
      "latency_median_ms",
      "latency_min_ms",
      "latency_max_ms",
      "latency_std_ms",
      "latency_p95_ms",
      "latency_p99_ms"
    ];
    const perClientRows = [perClientHeader];
    for (const c of perClient) {
      perClientRows.push([
        "webserial",
        intervalMs,
        CAMPAIGN.webserialClientCount,
        c.clientId,
        repNumber,
        durationSeconds,
        c.messagesReceived,
        c.uniqueSeqs,
        c.seqGapLost,
        c.errors,
        c.throughputMessagesPerSecond,
        c.latencySamples,
        c.latencyAvgMs,
        c.latencyMedianMs,
        c.latencyMinMs,
        c.latencyMaxMs,
        c.latencyStdMs,
        c.latencyP95Ms,
        c.latencyP99Ms
      ]);
    }
    writeFileSync(
      join(campaignDir, `${base}_per-client.csv`),
      rowsToCsv(perClientRows),
      "utf8"
    );

    console.log(
      `[multiclient]      WS-conv: webserial interval=${intervalMs}ms rep=${repNumber} ` +
        `thru=${round(throughput, 1)} msg/s ` +
        (latencyValid
          ? `p95=${round(run.estimatedLatencyP95Ms, 2) ?? "-"}ms`
          : `p95=- (fallback: ${latencyMethodLabel})`)
    );
    generatedAggregates.push(aggregateJson);
  }

  return generatedAggregates;
}

/**
 * Bloco de execucao do modo webserial: sobe o servidor estatico do prototipo,
 * autoriza a porta serial se necessario, delega para runWebserialCampaign
 * (1 chamada por replicacao com todos os intervalos), e converte os summaries
 * resultantes em aggregates do formato multi-cliente.
 */
async function runWebserialBlock({
  campaignDir,
  intervalsMs,
  clientCounts,
  reps,
  durationSeconds,
  source,
  webserialPort,
  userDataDir,
  autoBootstrap,
  resume
}) {
  if (!clientCounts.includes(1)) {
    console.log(
      `[multiclient] === MODO webserial === clientCounts ${clientCounts.join(",")} nao inclui 1; ` +
        `WebSerial e single-client por design e exige N=1. Pulando.`
    );
    return;
  }

  const skippedCounts = clientCounts.filter((n) => n !== 1);
  if (skippedCounts.length > 0) {
    console.log(
      `[multiclient] === MODO webserial === ignorando clientCount ${skippedCounts.join(",")} ` +
        `(WebSerial e single-client por design; sera executado apenas N=1).`
    );
  } else {
    console.log(`[multiclient] === MODO webserial === executando N=1 (limite arquitetural)`);
  }

  const webserialServer = await startWebserial({ port: webserialPort });
  try {
    const webserialBaseUrl = `http://localhost:${webserialPort}/`;

    if (source === "serial" && autoBootstrap) {
      const granted = await hasSerialPermission({ baseUrl: webserialBaseUrl, userDataDir });
      if (!granted) {
        console.log(
          "[multiclient] WebSerial sem permissao salva; abrindo bootstrap automatico."
        );
        await bootstrapSerialPermission({ baseUrl: webserialBaseUrl, userDataDir });
      }
    }

    const beforeFiles = new Set(readdirSync(campaignDir));

    await runWebserialCampaign({
      baseUrl: webserialBaseUrl,
      source,
      reps,
      durationSeconds,
      intervalsMs,
      campaignType: CAMPAIGN.type,
      resultsDir: campaignDir,
      userDataDir,
      resume,
      continueOnError: true,
      heartbeatIntervalMs: 30_000
    });

    const afterFiles = readdirSync(campaignDir);
    const newSummaries = afterFiles
      .filter((f) => !beforeFiles.has(f))
      .filter((f) => f.endsWith("_experiment-summary.json"))
      .filter((f) => f.startsWith("webserial_webserial_"));

    if (newSummaries.length === 0) {
      console.warn(
        "[multiclient] Nenhum experiment-summary.json novo de WebSerial encontrado. " +
          "Pode ser que --resume ja tenha pulado tudo, ou a campanha falhou silenciosamente."
      );
    } else {
      console.log(
        `[multiclient] Convertendo ${newSummaries.length} summary(s) de WebSerial em aggregates.`
      );
      for (const summaryFile of newSummaries) {
        convertWebserialSummaryToAggregates({
          summaryFile,
          campaignDir,
          source,
          durationSeconds,
          allowedIntervalsMs: intervalsMs
        });
      }
    }
  } finally {
    await stop(webserialServer);
  }
}

/**
 * Bloco de execucao para modos backend-Node (websocket, rest-polling).
 * Sobe o backend uma vez, itera intervalos x clientes x reps.
 */
async function runBackendBlock({
  mode,
  campaignDir,
  intervalsMs,
  clientCounts,
  reps,
  durationSeconds,
  source,
  resolvedSerialPort,
  backendPort,
  resume
}) {
  console.log(`\n[multiclient] === MODO ${mode} ===`);

  const backend = await startBackend({
    source,
    serialPort: resolvedSerialPort,
    port: backendPort
  });

  try {
    const baseUrl = `http://localhost:${backendPort}`;
    for (const intervalMs of intervalsMs) {
      for (const clientCount of clientCounts) {
        for (let rep = 1; rep <= reps; rep++) {
          console.log(
            `[multiclient] ${mode} | interval=${intervalMs}ms | clients=${clientCount} | rep=${rep}`
          );
          try {
            await runOneExecution({
              baseUrl,
              campaignDir,
              mode,
              intervalMs,
              clientCount,
              rep,
              durationSeconds,
              source,
              resume
            });
            await sleep(1500);
          } catch (error) {
            console.warn(
              `[multiclient]   FALHA (${mode} ${intervalMs}ms ${clientCount}cli rep${rep}): ${error.message}`
            );
            try {
              await stopExperiment(baseUrl);
            } catch {
              // ignore
            }
            await sleep(2000);
          }
        }
      }
    }
  } finally {
    await stop(backend);
  }
}

function consolidateAll(campaignDir) {
  const files = readdirSync(campaignDir).filter((n) => n.endsWith(`_${CAMPAIGN.type}_aggregate.json`));
  const records = files
    .map((name) => {
      try {
        const text = readFileSync(join(campaignDir, name), "utf8");
        return { file: name, data: JSON.parse(text) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const consolidated = records.map(({ file, data }) => ({
    file,
    mode: data.config.mode,
    interval_ms: data.config.intervalMs,
    client_count: data.config.clientCount,
    replication: data.config.replication,
    duration_seconds: data.config.durationSeconds,
    expected_messages_per_client: data.aggregate.expectedMessagesPerClient,
    messages_total_across_clients: data.aggregate.messagesTotalAcrossClients,
    throughput_aggregate_msgps: data.aggregate.throughputAggregateMessagesPerSecond,
    throughput_avg_per_client_msgps: data.aggregate.throughputAvgPerClient,
    throughput_std_per_client_msgps: data.aggregate.throughputStdPerClient,
    fairness_cv: data.aggregate.fairnessCoefficientOfVariation,
    latency_avg_mean_across_clients_ms: data.aggregate.latencyAvgMeanAcrossClients,
    latency_p95_worst_client_ms: data.aggregate.latencyP95WorstClientMs,
    cpu_avg_percent: data.resources?.cpuUsagePercent?.avg ?? null,
    cpu_p95_percent: data.resources?.cpuUsagePercent?.p95 ?? null,
    cpu_max_percent: data.resources?.cpuUsagePercent?.max ?? null,
    mem_rss_avg_mb: data.resources?.memRssMb?.avg ?? null,
    mem_rss_max_mb: data.resources?.memRssMb?.max ?? null,
    mem_heap_used_avg_mb: data.resources?.memHeapUsedMb?.avg ?? null,
    latency_method: data.aggregate.latencyMethod,
    sync_failed: data.clockSync?.syncFailed ?? null
  }));

  const headerKeys = consolidated.length ? Object.keys(consolidated[0]) : [];
  const csvRows = [headerKeys, ...consolidated.map((r) => headerKeys.map((k) => r[k]))];
  writeFileSync(join(campaignDir, "consolidated_metrics.csv"), rowsToCsv(csvRows), "utf8");

  writeFileSync(
    join(campaignDir, "consolidated_metrics.json"),
    JSON.stringify(
      {
        campaign: { name: CAMPAIGN.name, type: CAMPAIGN.type },
        executions: consolidated
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(`[multiclient] Consolidado em ${campaignDir}/consolidated_metrics.{csv,json} (${consolidated.length} execucoes).`);
}

function runPython(scriptName, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const child = spawn(pythonCmd, [resolve(rootDir, "scripts", scriptName), ...args], {
      stdio: "inherit",
      shell: false
    });
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${scriptName} saiu com codigo ${code}`));
    });
    child.on("error", rejectRun);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args["log-file"]) {
    initLogFile(resolve(rootDir, args["log-file"]));
  }

  const source = args.source === "simulator" ? "simulator" : "serial";
  const serialPortConfigured = args["serial-port"] ?? process.env.SERIAL_PORT ?? "auto";
  const reps = parsePositiveInt(args.reps, CAMPAIGN.defaultReps);
  const durationSeconds = parsePositiveInt(args.duration, CAMPAIGN.defaultDurationSeconds);
  const intervalsMs = parseIntList(args.intervals, CAMPAIGN.intervalsMs);
  const clientCounts = parseIntList(args.clients, CAMPAIGN.clientCounts);
  const modes = parseList(args.modes, CAMPAIGN.modes).map((m) => m.toLowerCase());
  const campaignDir = resolve(
    rootDir,
    args["campaign-dir"] ?? `resultados/${CAMPAIGN.name}`
  );
  const backendPort = parsePositiveInt(args["port-backend"], 3000);
  const webserialPort = parsePositiveInt(args["port-webserial"], 8765);
  const userDataDir = resolve(rootDir, args["chromium-user-data"] ?? ".playwright-profile");
  const skipAnalysis = Boolean(args["skip-analysis"]);
  const resume = !args["no-resume"];
  const keepAwakeEnabled = !args["no-keep-awake"];
  const autoBootstrap = !args["no-auto-bootstrap"];

  for (const m of modes) {
    if (!CAMPAIGN.modes.includes(m)) {
      throw new Error(`Modo invalido: ${m}. Use: ${CAMPAIGN.modes.join(", ")}.`);
    }
  }

  if (!existsSync(campaignDir)) mkdirSync(campaignDir, { recursive: true });

  if (args["bootstrap-webserial"]) {
    const webserialServer = await startWebserial({ port: webserialPort });
    try {
      await bootstrapSerialPermission({
        baseUrl: `http://localhost:${webserialPort}/`,
        userDataDir
      });
    } finally {
      await stop(webserialServer);
    }
    return;
  }

  const backendModes = modes.filter((m) => m !== "webserial");
  const includesWebserial = modes.includes("webserial");
  const backendRuns =
    backendModes.length * intervalsMs.length * clientCounts.length * reps;
  const webserialRuns = includesWebserial ? intervalsMs.length * reps : 0;
  const totalRuns = backendRuns + webserialRuns;
  const totalSeconds = totalRuns * durationSeconds;
  const estimatedMinutes = Math.ceil(totalSeconds / 60);

  const resolvedSerialPort =
    source === "serial" ? await resolveSerialPort(serialPortConfigured) : null;
  if (source === "serial" && !resolvedSerialPort) {
    console.warn(
      `[multiclient] Fonte serial sem porta COM detectada. Conecte o Arduino ou use --source simulator.`
    );
    return;
  }

  console.log("[multiclient] ============================================================");
  console.log(`[multiclient] Campanha: ${CAMPAIGN.name} (type=${CAMPAIGN.type})`);
  console.log(`[multiclient] ------------------------------------------------------------`);
  console.log(`  source           = ${source}${source === "serial" ? ` (${resolvedSerialPort})` : ""}`);
  console.log(`  modes            = ${modes.join(", ")}`);
  console.log(`  intervals (ms)   = ${intervalsMs.join(", ")}`);
  console.log(`  clients          = ${clientCounts.join(", ")} (webserial sempre N=1)`);
  console.log(`  reps             = ${reps}`);
  console.log(`  duration (s)     = ${durationSeconds}`);
  console.log(`  backend runs     = ${backendRuns} (WS/REST: ${backendModes.join(", ") || "-"})`);
  console.log(`  webserial runs   = ${webserialRuns}`);
  console.log(`  total execucoes  = ${totalRuns}`);
  console.log(`  duracao estimada = ~${estimatedMinutes} min de coleta`);
  console.log(`  campaignDir      = ${campaignDir}`);
  console.log(`  resume           = ${resume}`);
  console.log(`  keepAwake        = ${keepAwakeEnabled}`);
  console.log(`  autoBootstrap    = ${autoBootstrap}`);
  console.log(`  skipAnalysis     = ${skipAnalysis}`);
  console.log("[multiclient] ============================================================\n");

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    for (const mode of modes) {
      try {
        if (mode === "webserial") {
          await runWebserialBlock({
            campaignDir,
            intervalsMs,
            clientCounts,
            reps,
            durationSeconds,
            source,
            webserialPort,
            userDataDir,
            autoBootstrap,
            resume
          });
        } else {
          await runBackendBlock({
            mode,
            campaignDir,
            intervalsMs,
            clientCounts,
            reps,
            durationSeconds,
            source,
            resolvedSerialPort,
            backendPort,
            resume
          });
        }
      } catch (error) {
        console.warn(
          `[multiclient] Modo '${mode}' falhou em alto nivel: ${error.message}. Seguindo para o proximo.`
        );
      }
    }

    consolidateAll(campaignDir);

    if (!skipAnalysis) {
      try {
        await runPython("plot_multiclient.py", [campaignDir]);
      } catch (error) {
        console.warn(
          `[multiclient] Pos-processamento opcional falhou (${error.message}). CSV/JSON estao salvos.`
        );
      }
    }

    console.log(`\n[multiclient] Concluido. Arquivos em ${campaignDir}.`);
  } finally {
    keepAwake.stop();
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[multiclient] ERRO: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
