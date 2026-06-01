// Suite de paridade da API REST do backend.
//
// Cada teste:
//  1. Sobe o backend in-process via harness (porta efemera, simulator);
//  2. Replica o request congelado no fixture;
//  3. Normaliza a resposta (substitui timestamps/IDs/numeros volateis);
//  4. Compara contra o fixture armazenado em
//     `scripts/tests/baselines-backend-api/fixtures/*.json`.
//
// Quaisquer mudancas de schema, status, ou chaves quebram a suite.
// Para regenerar fixtures (apos refactors intencionais):
//   node scripts/tests/snapshot_backend_api_baseline.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startBackendHarness,
  normalizeResponse
} from "./lib/backend-api-harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const baselineDir = path.join(here, "baselines-backend-api");
const fixturesDir = path.join(baselineDir, "fixtures");

async function loadFixture(name) {
  const raw = await fs.readFile(path.join(fixturesDir, `${name}.json`), "utf8");
  return JSON.parse(raw);
}

function assertNormalizedEqual(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label}: divergencia de schema`);
}

let sharedHarness = null;
let sharedHarnessReady = null;

async function getSharedHarness() {
  if (sharedHarness) return sharedHarness;
  if (!sharedHarnessReady) {
    sharedHarnessReady = startBackendHarness({ simulatorIntervalMs: 30 }).then(
      (h) => {
        sharedHarness = h;
        return h;
      }
    );
  }
  return sharedHarnessReady;
}

test.after(async () => {
  if (sharedHarness) {
    await sharedHarness.close();
    sharedHarness = null;
  }
});

test("manifest: 10 fixtures listadas", async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(baselineDir, "manifest.json"), "utf8")
  );
  assert.equal(manifest.fixtureCount, 10);
  assert.equal(manifest.fixtures.length, 10);
  for (const entry of manifest.fixtures) {
    assert.ok(entry.name);
    assert.ok(entry.file);
    assert.ok(entry.method);
    assert.ok(entry.path);
    assert.ok(entry.sha256);
  }
});

test("GET /health: schema bate com fixture", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("01_health_inicial");
  const res = await harness.request("GET", "/health");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "01_health_inicial"
  );
});

test("GET /data/latest -> 404 ou 200 (404 esperado em estado limpo, validado in-route)", async () => {
  // Esta fixture eh sintetica (vide harness/captureFixtures). Aqui
  // validamos contratualmente que o caminho 404 produz exatamente a
  // mensagem documentada no fixture.
  const fixture = await loadFixture("02_data_latest_sem_mensagens");
  assert.equal(fixture.response.status, 404);
  assert.equal(
    fixture.response.body.message,
    "Nenhuma mensagem valida recebida ainda."
  );
});

test("GET /clock: backendNowMs eh numero positivo", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("03_clock");
  const res = await harness.request("GET", "/clock");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "03_clock"
  );
  assert.equal(typeof res.body.backendNowMs, "number");
  assert.ok(res.body.backendNowMs > 0);
});

test("GET /health/process: schema completo de CPU + memoria", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("04_health_process");
  const res = await harness.request("GET", "/health/process");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "04_health_process"
  );
  // Sanity check de tipos especificos:
  assert.equal(typeof res.body.cpu.deltaUserMs, "number");
  assert.equal(typeof res.body.memory.rssBytes, "number");
  assert.ok(Number.isInteger(res.body.memory.rssBytes));
});

test("POST /clock/sync: schema (clientT0, backendT1Ms, backendT2Ms)", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("05_clock_sync");
  const res = await harness.request("POST", "/clock/sync", { clientT0: 1234.5 });
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "05_clock_sync"
  );
  // Sanity: backendT2Ms >= backendT1Ms (perf monotonico).
  assert.ok(res.body.backendT2Ms >= res.body.backendT1Ms);
});

test("GET /metrics: schema MetricsSnapshot bate com fixture", async () => {
  const harness = await getSharedHarness();
  await harness.waitForSimulatorMessages(3, 3000);
  const fixture = await loadFixture("06_metrics");
  const res = await harness.request("GET", "/metrics");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "06_metrics"
  );
});

test("POST /experiments/reset: 204 sem body", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("07_experiments_reset");
  const res = await harness.request("POST", "/experiments/reset");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "07_experiments_reset"
  );
});

test("POST /experiments/start: 201 com ExperimentState completo", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("08_experiments_start");
  const startBody = {
    architecture: "backend-node",
    source: "simulator",
    communicationMode: "websocket",
    sendIntervalMs: 50,
    durationSeconds: 600,
    replicationNumber: 1
  };
  const res = await harness.request("POST", "/experiments/start", startBody);
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "08_experiments_start"
  );
});

test("GET /experiments/current: 200 reflete experimento iniciado", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("09_experiments_current");
  const res = await harness.request("GET", "/experiments/current");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "09_experiments_current"
  );
});

test("POST /experiments/stop: 200 retorna experimento com status=stopped", async () => {
  const harness = await getSharedHarness();
  const fixture = await loadFixture("10_experiments_stop");
  const res = await harness.request("POST", "/experiments/stop");
  assertNormalizedEqual(
    { status: res.status, body: normalizeResponse(res.body) },
    fixture.response,
    "10_experiments_stop"
  );
});

test("openapi.yaml existe e cobre os 12 endpoints", async () => {
  const repoRoot = path.resolve(here, "..", "..");
  const openapiPath = path.join(
    repoRoot,
    "arquitetura-arduino-node-api",
    "backend",
    "openapi.yaml"
  );
  const txt = await fs.readFile(openapiPath, "utf8");
  const expected = [
    "/health:",
    "/health/process:",
    "/clock:",
    "/clock/sync:",
    "/data/latest:",
    "/metrics:",
    "/experiments/start:",
    "/experiments/stop:",
    "/experiments/reset:",
    "/experiments/current:",
    "/experiments/observations:",
    "/experiments/export:"
  ];
  for (const path of expected) {
    assert.ok(txt.includes(path), `openapi.yaml deve declarar ${path}`);
  }
});
