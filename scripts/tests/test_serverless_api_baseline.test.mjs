// Teste smoke do contrato dos endpoints da arquitetura serverless (A3).
//
// As funcoes em `arquitetura-serverless/api/*.ts` sao consumidas pela
// Vercel via VercelRequest/VercelResponse. Aqui montamos mocks dessas
// duas interfaces e chamamos cada handler in-process para validar:
//   - status code esperado;
//   - chaves do body de resposta;
//   - aceitacao/rejeicao do payload do ESP32 (mesmas regras que o backend Node).
//
// Os arquivos .ts dos handlers sao importados via `tsx` apenas se a
// dependencia estiver instalada. Se nao houver tsx, o teste e SKIPPED
// (a CI principal ja roda os tests do backend; o serverless ganha
// validacao quando o ambiente local tiver tsx).

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const serverlessRoot = join(repoRoot, "arquitetura-serverless");
const tsxBinFolder = join(serverlessRoot, "node_modules", "tsx");
const hasTsx = existsSync(tsxBinFolder);

function makeReq({ method = "GET", body, query = {}, headers = {} } = {}) {
  return { method, body, query, headers };
}

function makeRes() {
  let statusCode = 200;
  let payload;
  const headersOut = {};
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(value) {
      payload = value;
      return res;
    },
    setHeader(key, value) {
      headersOut[key] = value;
      return res;
    },
    end() {
      return res;
    },
    get statusCode() { return statusCode; },
    get body() { return payload; },
    get headers() { return headersOut; }
  };
  return res;
}

let mod = null;
async function loadModule(relPath) {
  if (!hasTsx) return null;
  if (!mod) {
    try {
      mod = await import("tsx/esm/api");
    } catch {
      mod = null;
      return null;
    }
  }
  const url = new URL(`./${relPath}`, `file://${serverlessRoot.replace(/\\/g, "/")}/`);
  return mod.tsImport(url.href, import.meta.url);
}

test("[serverless] /api/health responde com status:'ok'", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/health.ts"))?.default;
  if (!handler) return;
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "ok");
});

test("[serverless] /api/ingest aceita payload valido", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/ingest.ts"))?.default;
  if (!handler) return;
  const sample = {
    deviceId: "esp32-01",
    seq: 1,
    send_us: 1717000000000000,
    hr: 80,
    ax: 0.1,
    ay: 0,
    az: 1,
    wifi_rssi_dbm: -55,
    wifi_reconnects: 0
  };
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: sample }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, true);
});

test("[serverless] /api/ingest rejeita payload sem deviceId", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/ingest.ts"))?.default;
  if (!handler) return;
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { seq: 1, send_us: 1, hr: 80, ax: 0, ay: 0, az: 1 } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.accepted, false);
});

test("[serverless] /api/ingest rejeita metodo nao-POST", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/ingest.ts"))?.default;
  if (!handler) return;
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 405);
});

test("[serverless] /api/clock/sync devolve t1/t2 e serverNowEpochMs", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/clock/sync.ts"))?.default;
  if (!handler) return;
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { clientT0: 1234.5 } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok("backendT1Ms" in res.body);
  assert.ok("backendT2Ms" in res.body);
  assert.ok("serverNowEpochMs" in res.body);
});

test("[serverless] /api/data/latest sem amostras devolve 404", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/data/latest.ts"))?.default;
  if (!handler) return;
  const res = makeRes();
  await handler(makeReq({ method: "GET", query: { deviceId: `unused-${Date.now()}` } }), res);
  assert.equal(res.statusCode, 404);
});

test("[serverless] /api/config aceita POST e devolve intervalMs", { skip: !hasTsx }, async () => {
  const handler = (await loadModule("api/config.ts"))?.default;
  if (!handler) return;
  const post = makeRes();
  await handler(makeReq({ method: "POST", body: { intervalMs: 200 } }), post);
  assert.equal(post.statusCode, 200);
  assert.equal(post.body.intervalMs, 200);

  const get = makeRes();
  await handler(makeReq({ method: "GET" }), get);
  assert.equal(get.statusCode, 200);
  assert.equal(typeof get.body.intervalMs, "number");
});
