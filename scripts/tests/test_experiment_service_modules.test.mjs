// Testes unitarios para os modulos extraidos de experimentService.ts
// (Sub-fase 4.1). Cobre os builders puros (csv-utils, config, saturation,
// sensor-data-csv, metrics-csv, summary-builder) carregados diretamente
// do dist/ compilado, garantindo paridade bit-a-bit do que e' servido em
// producao.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(
  here,
  "..",
  "..",
  "arquitetura-arduino-node-api",
  "backend",
  "dist",
  "services",
  "experiments"
);

const csvUtils = require(path.join(distRoot, "csv-utils.js"));
const configMod = require(path.join(distRoot, "config.js"));
const constantsMod = require(path.join(distRoot, "constants.js"));
const saturationMod = require(path.join(distRoot, "saturation.js"));
const sensorDataMod = require(path.join(distRoot, "sensor-data-csv.js"));
const metricsCsvMod = require(path.join(distRoot, "metrics-csv.js"));
const summaryMod = require(path.join(distRoot, "summary-builder.js"));

// ---------- csv-utils ----------

test("csv-utils: escapeCsv preserva texto simples", () => {
  assert.equal(csvUtils.escapeCsv("hello"), "hello");
  assert.equal(csvUtils.escapeCsv(42), "42");
  assert.equal(csvUtils.escapeCsv(null), "");
});

test("csv-utils: escapeCsv envolve texto com virgula/aspas/newline", () => {
  assert.equal(csvUtils.escapeCsv("a,b"), '"a,b"');
  assert.equal(csvUtils.escapeCsv('a"b'), '"a""b"');
  assert.equal(csvUtils.escapeCsv("a\nb"), '"a\nb"');
});

test("csv-utils: toCsv junta linhas com \\n sem trailing newline", () => {
  const csv = csvUtils.toCsv([
    ["a", "b", "c"],
    [1, 2, 3]
  ]);
  assert.equal(csv, "a,b,c\n1,2,3");
});

test("csv-utils: percent retorna 0 quando total<=0, senao 3 casas decimais", () => {
  assert.equal(csvUtils.percent(0, 0), 0);
  assert.equal(csvUtils.percent(0, -1), 0);
  assert.equal(csvUtils.percent(1, 4), 25);
  assert.equal(csvUtils.percent(1, 3), 33.333);
});

test("csv-utils: round e roundNullable respeitam digits=3", () => {
  assert.equal(csvUtils.round(1.234567), 1.235);
  assert.equal(csvUtils.round(1.234567, 5), 1.23457);
  // JS `toFixed` usa "round half to even" para alguns valores binarios:
  // (2.5555).toFixed(3) -> "2.555" porque 2.5555 nao tem representacao
  // exata em float64. Mantemos o comportamento nativo.
  assert.equal(csvUtils.roundNullable(2.5555), 2.555);
  assert.equal(csvUtils.roundNullable(null), "");
  assert.equal(csvUtils.roundNullable(undefined), "");
  assert.equal(csvUtils.roundNullable(Number.NaN), "");
  assert.equal(csvUtils.roundNullable(Infinity), "");
});

test("csv-utils: environmentToCsv lida com undefined e substitui ; por ,", () => {
  assert.equal(csvUtils.environmentToCsv(undefined), "");
  assert.equal(csvUtils.environmentToCsv({ a: "1", b: "x;y" }), "a=1; b=x,y");
});

// ---------- config ----------

test("config: readPositiveInteger valida positivos inteiros", () => {
  assert.equal(configMod.readPositiveInteger(5, 99), 5);
  assert.equal(configMod.readPositiveInteger(0, 99), 99);
  assert.equal(configMod.readPositiveInteger(-3, 99), 99);
  assert.equal(configMod.readPositiveInteger(1.5, 99), 99);
  assert.equal(configMod.readPositiveInteger("7", 99), 7);
  assert.equal(configMod.readPositiveInteger("abc", 99), 99);
});

test("config: normalizeConfig aplica defaults e enums", () => {
  const result = configMod.normalizeConfig({});
  assert.deepEqual(result, {
    architecture: "backend-node",
    source: "wifi-http",
    communicationMode: "websocket",
    sendIntervalMs: 100,
    durationSeconds: 60,
    replicationNumber: 1
  });
});

test("config: normalizeConfig respeita valores validos", () => {
  const result = configMod.normalizeConfig({
    architecture: "webserial",
    source: "serial",
    communicationMode: "rest-polling",
    sendIntervalMs: 50,
    durationSeconds: 30,
    replicationNumber: 5
  });
  assert.deepEqual(result, {
    architecture: "webserial",
    source: "serial",
    communicationMode: "rest-polling",
    sendIntervalMs: 50,
    durationSeconds: 30,
    replicationNumber: 5
  });
});

test("config: createExperimentId tem formato exp-<ISO>Z (sem `:`/`.`)", () => {
  const id = configMod.createExperimentId();
  assert.match(id, /^exp-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
});

// ---------- saturation ----------

function buildSummary(over) {
  return {
    experimentId: over.experimentId ?? "exp-1",
    architecture: "backend-node",
    communicationMode: "websocket",
    source: "simulator",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: "2026-01-01T00:01:00.000Z",
    durationSeconds: 60,
    intervalMs: over.intervalMs,
    applicationVersion: "0.1.0",
    replicationNumber: 1,
    environment: "",
    latencyType: "clock_synchronized_estimated_end_to_end",
    latencyMethod: "ntp_style_clock_offset_estimation",
    latencyLimitation: "",
    latencyEstimationMethod: "ntp_style_clock_offset_estimation",
    latencyMethodologyNote: "",
    latencyBaselineSendMs: null,
    latencyBaselineReceiveMs: null,
    expectedMessages: 600,
    receivedMessages: over.receivedMessages ?? 600,
    missingMessages: over.missingMessages ?? 0,
    sequenceGapMessages: 0,
    lostMessages: 0,
    invalidMessages: 0,
    messagesPerSecond: 10,
    throughputPercent: over.throughputPercent ?? 100,
    missingMessagesPercent: 0,
    lostPercent: 0,
    estimatedLatencySamples: over.estimatedLatencySamples ?? 0,
    estimatedLatencyAverageMs: over.estimatedLatencyAverageMs ?? null,
    estimatedLatencyMinMs: null,
    estimatedLatencyMaxMs: null,
    estimatedLatencyStdDevMs: null,
    estimatedLatencyP95Ms: over.estimatedLatencyP95Ms ?? null,
    saturationIndicators: [],
    saturationIndicatorCodes: []
  };
}

test("saturation: addSaturationIndicators detecta throughput<95% e loss", () => {
  const summaries = [
    buildSummary({ intervalMs: 100, throughputPercent: 100 }),
    buildSummary({ intervalMs: 50, throughputPercent: 90, missingMessages: 10 })
  ];
  saturationMod.addSaturationIndicators(summaries);
  assert.deepEqual(summaries[0].saturationIndicatorCodes, []);
  assert.ok(summaries[1].saturationIndicatorCodes.includes("throughput_below_95"));
  assert.ok(summaries[1].saturationIndicatorCodes.includes("message_loss_detected"));
});

test("saturation: addSaturationIndicators detecta latency_average_doubled", () => {
  const summaries = [
    buildSummary({ intervalMs: 100, estimatedLatencyAverageMs: 5 }),
    buildSummary({ intervalMs: 50, estimatedLatencyAverageMs: 12 }) // > 5*2
  ];
  saturationMod.addSaturationIndicators(summaries);
  assert.ok(summaries[1].saturationIndicatorCodes.includes("latency_average_doubled"));
});

test("saturation: createSaturationAnalysis prioriza menor intervalo nas detecoes", () => {
  const summaries = [
    buildSummary({ intervalMs: 100, throughputPercent: 100 }),
    buildSummary({ intervalMs: 50, throughputPercent: 88, missingMessages: 5 }),
    buildSummary({ intervalMs: 25, throughputPercent: 70, missingMessages: 20 })
  ];
  const result = saturationMod.createSaturationAnalysis(summaries);
  // O sort eh DESCENDENTE por intervalMs (100,50,25), entao a primeira saturada
  // achada eh intervalMs=50 (a primeira do array sortado que tem o problema).
  assert.equal(result.saturationAnalysis.firstThroughputBelow95IntervalMs, 50);
  assert.equal(result.saturationAnalysis.firstLossDetectedIntervalMs, 50);
  assert.equal(result.saturation.throughputThresholdPercent, 95);
  assert.equal(result.saturation.latencyGrowthFactor, 2);
});

test("saturation: createFallbackSummary inclui campos obrigatorios e syncFailed=>relative", () => {
  const experiment = {
    id: "exp-1",
    architecture: "backend-node",
    communicationMode: "websocket",
    source: "simulator",
    sendIntervalMs: 100,
    durationSeconds: 60,
    replicationNumber: 1,
    status: "stopped",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: "2026-01-01T00:01:00.000Z",
    clockSync: null
  };
  const clockSync = { syncFailed: true };
  const summary = saturationMod.createFallbackSummary(
    experiment,
    600,
    580,
    20,
    20,
    0,
    9.667,
    clockSync
  );
  assert.equal(summary.experimentId, "exp-1");
  assert.equal(summary.expectedMessages, 600);
  assert.equal(summary.receivedMessages, 580);
  assert.equal(summary.missingMessages, 20);
  assert.equal(summary.latencyType, "relative_fallback");
  assert.equal(
    summary.latencyMethod,
    "relative_offset_between_arduino_millis_and_frontend_performance_now"
  );
  assert.ok(summary.throughputPercent > 0);
});

// ---------- sensor-data-csv ----------

test("sensor-data-csv: header + fallback rows quando nao ha observacoes", () => {
  const experiment = {
    id: "exp-1",
    architecture: "backend-node",
    communicationMode: "websocket",
    source: "simulator",
    sendIntervalMs: 100,
    durationSeconds: 60,
    replicationNumber: 1,
    status: "stopped",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: null
  };
  const fallbackSamples = [
    {
      sensor: { id: 1, heartRate: 75, acceleration: { x: 0.1, y: 0.2, z: 0.98 } },
      arduinoSendUs: 12345,
      estimatedBackendSendTimeMs: 1.5,
      backendArduinoClockOffsetMs: 0.3,
      backendArduinoClockUncertaintyMs: 0.05
    }
  ];
  const csv = sensorDataMod.createSensorDataCsv(experiment, [], fallbackSamples);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    "experiment_id,architecture,communication_mode,source,interval_ms,seq,send_us,frontend_receive_ms,estimated_frontend_send_ms,end_to_end_latency_ms,clock_offset_ms,clock_uncertainty_ms,sync_rtt_ms,latency_method,hr,ax,ay,az"
  );
  assert.ok(lines[1].startsWith("exp-1,backend-node,websocket,simulator,100,1,12345,,1.5,,0.3,0.05,,,75,"));
});

// ---------- metrics-csv ----------

test("metrics-csv: 33 colunas no header + 1 row de fallback quando nao ha observacoes", () => {
  const experiment = {
    id: "exp-1",
    architecture: "backend-node",
    communicationMode: "websocket",
    source: "simulator",
    sendIntervalMs: 100,
    durationSeconds: 60,
    replicationNumber: 1,
    status: "stopped",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: "2026-01-01T00:01:00.000Z"
  };
  const csv = metricsCsvMod.createMetricsCsv({
    experiment,
    metrics: null,
    observations: [],
    observation: undefined,
    invalidMessageCount: 0,
    fallbackSamplesLength: 600
  });
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  const headerCols = lines[0].split(",");
  assert.equal(headerCols.length, 33);
  assert.equal(headerCols[0], "experiment_id");
  assert.equal(headerCols[headerCols.length - 1], "acceleration_magnitude_avg");
});

// ---------- summary-builder ----------

test("summary-builder: createSummary produz JSON com campos chave", () => {
  const experiment = {
    id: "exp-1",
    architecture: "backend-node",
    communicationMode: "websocket",
    source: "simulator",
    sendIntervalMs: 100,
    durationSeconds: 60,
    replicationNumber: 1,
    status: "stopped",
    startedAt: "2026-01-01T00:00:00.000Z",
    stoppedAt: "2026-01-01T00:01:00.000Z",
    clockSync: null
  };
  const result = summaryMod.createSummary({
    experiment,
    metrics: null,
    observations: [],
    observation: undefined,
    invalidMessages: [],
    fallbackSamplesLength: 600,
    currentClockSync: null
  });
  assert.equal(result.campaign, null);
  assert.ok(Array.isArray(result.runs));
  assert.equal(result.runs.length, 1);
  assert.equal(result.expectedMessages, 600);
  assert.equal(result.receivedMessages, 600);
  assert.equal(result.missingMessages, 0);
  assert.equal(result.throughputPercent, 100);
  assert.ok(result.saturation);
  assert.equal(result.saturation.throughputThresholdPercent, 95);
  assert.equal(result.interpretation.realTimeAdequacy.includes("WebSocket"), true);
});

// ---------- constants ----------

test("constants: SCIENTIFIC_CONFIG e DEFAULT_EXPERIMENT estaveis", () => {
  assert.equal(constantsMod.SCIENTIFIC_CONFIG.applicationVersion, "0.1.0");
  assert.equal(constantsMod.SCIENTIFIC_CONFIG.throughputSaturationPercent, 95);
  assert.equal(constantsMod.SCIENTIFIC_CONFIG.latencyGrowthFactor, 2);
  assert.equal(constantsMod.DEFAULT_EXPERIMENT.sendIntervalMs, 100);
  assert.equal(constantsMod.DEFAULT_EXPERIMENT.durationSeconds, 60);
});

// ---------- contagem de linhas ----------

test("loc: experimentService.ts deve ter <= 250 linhas pos-refactor", async () => {
  const fs = await import("node:fs/promises");
  const repoRoot = path.resolve(here, "..", "..");
  const src = await fs.readFile(
    path.join(repoRoot, "arquitetura-arduino-node-api", "backend", "src", "services", "experimentService.ts"),
    "utf8"
  );
  const lines = src.split("\n").length;
  assert.ok(lines <= 250, `experimentService.ts tem ${lines} linhas, esperado <=250`);
});
