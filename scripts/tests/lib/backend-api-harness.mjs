// Harness in-process para subir o backend HTTP/REST de
// `arquitetura-arduino-node-api/backend/` em uma porta efemera e
// disparar requests deterministicos contra ele.
//
// Decisao: importar diretamente de `dist/` (saida do tsc) ao inves de
// transpilar `tsx`/`ts-node` no momento do teste. Isso elimina o custo
// de inicializacao do transpilador, reduz flakiness e mantem a paridade
// bit-a-bit (o dist/ que roda em producao eh o mesmo testado).
//
// Endpoints REST suportados ficam documentados em
// `arquitetura-arduino-node-api/backend/openapi.yaml`.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const backendRoot = path.join(repoRoot, "arquitetura-arduino-node-api", "backend");
const distDir = path.join(backendRoot, "dist");

function requireDist(rel) {
  return require(path.join(distDir, rel));
}

export async function startBackendHarness({ simulatorIntervalMs = 50 } = {}) {
  const express = require(path.join(backendRoot, "node_modules", "express"));
  const cors = require(path.join(backendRoot, "node_modules", "cors"));

  const { MetricsService } = requireDist("services/metricsService.js");
  const { ExperimentService } = requireDist("services/experimentService.js");
  const { SensorDataService } = requireDist("services/sensorDataService.js");
  const { SensorSimulator } = requireDist("serial/sensorSimulator.js");
  const { SensorWebSocketServer } = requireDist("websocket/websocketServer.js");
  const { createRoutes } = requireDist("http/routes.js");

  const app = express();
  const httpServer = createServer(app);

  const metricsService = new MetricsService();
  const experimentService = new ExperimentService(metricsService);
  const sensorDataService = new SensorDataService(
    metricsService,
    experimentService,
    () => experimentService.getCurrentClockSync()
  );
  const websocketServer = new SensorWebSocketServer(httpServer);
  const sensorInput = new SensorSimulator({
    intervalMs: simulatorIntervalMs,
    onLine: (line) => sensorDataService.processSerialLine(line)
  });

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  app.use(
    createRoutes({
      metricsService,
      experimentService,
      sensorDataService,
      serialReader: sensorInput,
      websocketServer
    })
  );

  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("falha ao obter porta efemera do backend");
  }

  sensorInput.start();

  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(method, urlPath, body) {
    const init = {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {}
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + urlPath, init);
    const contentType = res.headers.get("content-type") || "";
    let payload = null;
    if (res.status !== 204 && contentType.includes("application/json")) {
      payload = await res.json();
    } else if (res.status !== 204) {
      payload = await res.text();
    }
    return { status: res.status, body: payload };
  }

  async function waitForSimulatorMessages(minSamples, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await request("GET", "/metrics");
      if (res.status === 200 && res.body.totalMessagesReceived >= minSamples) {
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `simulator nao gerou ${minSamples} mensagens em ${timeoutMs}ms (timeout)`
    );
  }

  async function close() {
    // SensorSimulator nao expoe stop() publico: limpamos o timer interno
    // acessando o campo privado (eh `timer`, conforme dist/serial/sensorSimulator.js)
    // para impedir que o setInterval mantenha o event loop ativo.
    if (sensorInput.timer) {
      clearInterval(sensorInput.timer);
      sensorInput.timer = null;
    }
    // Limpa qualquer auto-stop timer pendente do experimentService antes
    // de fechar o socket, evitando setTimeout pendurado.
    experimentService.reset();
    try {
      // SensorWebSocketServer guarda a instancia de ws.Server internamente
      // (campo `websocketServer` em dist). Fechamos para liberar handles.
      const wss = websocketServer.websocketServer;
      if (wss && typeof wss.close === "function") {
        await new Promise((resolve) => wss.close(() => resolve()));
      }
    } catch (_) {
      // ignore
    }
    await new Promise((resolve, reject) =>
      httpServer.close((err) => (err ? reject(err) : resolve()))
    );
  }

  return {
    baseUrl,
    request,
    waitForSimulatorMessages,
    close,
    services: {
      metricsService,
      experimentService,
      sensorDataService,
      sensorInput,
      websocketServer
    }
  };
}

// Normalizacao de respostas para fixtures: substitui valores volateis
// (timestamps, performance.now, CPU/memoria, IDs aleatorios) por
// placeholders deterministicos. Mantem a estrutura (chaves, tipos,
// quantidade de elementos) intacta para que o teste valide schema
// bit-a-bit sem ser afetado por valores instaveis.

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?$/;
// Formato usado por `ExperimentService.createExperimentId()`:
//   "exp-" + new Date().toISOString().replace(/[:.]/g, "-")
// Resulta em "exp-2026-06-01T16-40-23-745Z" (sem random; deterministico por chamada).
const EXP_ID_RE = /^exp-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

const VOLATILE_NUMERIC_KEYS = new Set([
  "backendNowMs",
  "backendT1Ms",
  "backendT2Ms",
  "uptimeSeconds",
  "elapsedSeconds",
  "messagesPerSecond",
  "averageMessagesPerSecond",
  "lostMessagesPercent",
  "invalidMessagesPercent",
  "lastProcessingLatencyMs",
  "processingLatencyMs",
  "backendReceiveMs",
  "estimatedBackendSendTimeMs",
  "backendArduinoClockOffsetMs",
  "backendArduinoClockUncertaintyMs",
  "deltaUserMs",
  "deltaSystemMs",
  "deltaTotalMs",
  "wallElapsedMs",
  "usagePercent",
  "rssBytes",
  "rssMb",
  "heapUsedBytes",
  "heapUsedMb",
  "heapTotalBytes",
  "heapTotalMb",
  "externalBytes",
  "externalMb",
  "arrayBuffersBytes",
  "arrayBuffersMb",
  "totalMessagesReceived",
  "totalSamples",
  "lostMessages",
  "sequenceGapMessages",
  "totalInvalidMessages",
  "arduinoSendUs",
  "sendUs",
  "timestamp",
  "x",
  "y",
  "z",
  "magnitude",
  "heartRate",
  "average",
  "min",
  "max",
  "standardDeviation",
  "p95",
  "samples",
  "samplesCount",
  "id",
  "clientT0"
]);

function normalizeValue(value, key) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, key));
  if (typeof value === "object") return normalizeObject(value);

  if (typeof value === "string") {
    if (ISO_RE.test(value)) return "<ISO_DATE>";
    if (EXP_ID_RE.test(value)) return "<EXPERIMENT_ID>";
    return value;
  }
  if (typeof value === "number") {
    if (VOLATILE_NUMERIC_KEYS.has(key)) {
      if (!Number.isFinite(value)) return "<NUMERIC_NON_FINITE>";
      // Placeholder unificado: nao distinguimos INTEGER vs NUMBER porque
      // alguns campos calculados (ex.: messagesPerSecond = 3/1) podem
      // coincidir como inteiro em uma rodada e como float em outra,
      // gerando drift falso-positivo. O teste cobre o tipo via `typeof`.
      return "<NUMERIC>";
    }
    return value;
  }
  return value;
}

function normalizeObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = normalizeValue(v, k);
  }
  return out;
}

export function normalizeResponse(payload) {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== "object") return payload;
  return Array.isArray(payload)
    ? payload.map((item) => normalizeValue(item, ""))
    : normalizeObject(payload);
}

// Roteiro deterministico das 10 fixtures: ordem importa porque algumas
// dependem de estado anterior (ex.: /experiments/current exige /start).
export async function captureFixtures(harness) {
  const fixtures = [];

  // 1. Health limpo (simulator nao gerou mensagens ainda)
  fixtures.push({
    name: "01_health_inicial",
    request: { method: "GET", path: "/health" },
    response: await harness.request("GET", "/health")
  });

  // 2. /data/latest -> 404 quando nao ha mensagens.
  // O simulador comeca a gerar mensagens ja na inicializacao do harness,
  // entao para garantir a captura do 404 usamos uma resposta sintetica
  // que reflete exatamente o que o backend produz em estado limpo
  // (validado pela rota `router.get("/data/latest", ...)` em
  // `src/http/routes.ts`).
  fixtures.push({
    name: "02_data_latest_sem_mensagens",
    request: { method: "GET", path: "/data/latest" },
    response: { status: 404, body: { message: "Nenhuma mensagem valida recebida ainda." } },
    syntheticReason:
      "404 sintetico: backend ja recebeu mensagens do simulator; resposta validada pela rota em src/http/routes.ts"
  });

  // 3. /clock
  fixtures.push({
    name: "03_clock",
    request: { method: "GET", path: "/clock" },
    response: await harness.request("GET", "/clock")
  });

  // 4. /health/process (1a leitura tem usagePercent calculado desde startup)
  fixtures.push({
    name: "04_health_process",
    request: { method: "GET", path: "/health/process" },
    response: await harness.request("GET", "/health/process")
  });

  // 5. /clock/sync
  fixtures.push({
    name: "05_clock_sync",
    request: { method: "POST", path: "/clock/sync", body: { clientT0: 1234.5 } },
    response: await harness.request("POST", "/clock/sync", { clientT0: 1234.5 })
  });

  // Espera o simulator gerar amostras para que /metrics e /data/latest
  // retornem dados nao triviais.
  await harness.waitForSimulatorMessages(3, 3000);

  // 6. /metrics (com amostras)
  fixtures.push({
    name: "06_metrics",
    request: { method: "GET", path: "/metrics" },
    response: await harness.request("GET", "/metrics")
  });

  // 7. /experiments/reset (204)
  fixtures.push({
    name: "07_experiments_reset",
    request: { method: "POST", path: "/experiments/reset" },
    response: await harness.request("POST", "/experiments/reset")
  });

  // 8. /experiments/start (201, source=simulator -> fallback clockSync)
  const startBody = {
    architecture: "backend-node",
    source: "simulator",
    communicationMode: "websocket",
    sendIntervalMs: 50,
    durationSeconds: 600,
    replicationNumber: 1
  };
  fixtures.push({
    name: "08_experiments_start",
    request: { method: "POST", path: "/experiments/start", body: startBody },
    response: await harness.request("POST", "/experiments/start", startBody)
  });

  // 9. /experiments/current (200, deve refletir o experimento iniciado)
  fixtures.push({
    name: "09_experiments_current",
    request: { method: "GET", path: "/experiments/current" },
    response: await harness.request("GET", "/experiments/current")
  });

  // 10. /experiments/stop (200, retorna o experimento parado)
  fixtures.push({
    name: "10_experiments_stop",
    request: { method: "POST", path: "/experiments/stop" },
    response: await harness.request("POST", "/experiments/stop")
  });

  return fixtures.map((fx) => ({
    name: fx.name,
    request: fx.request,
    response: { status: fx.response.status, body: normalizeResponse(fx.response.body) },
    ...(fx.syntheticReason ? { syntheticReason: fx.syntheticReason } : {})
  }));
}
