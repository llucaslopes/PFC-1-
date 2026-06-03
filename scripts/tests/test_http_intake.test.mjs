// Teste end-to-end do caminho oficial Wi-Fi (A1/A2):
//   POST /ingest/sensor -> SensorDataService -> MetricsService -> GET /metrics + /data/latest
//
// Sobe o backend in-process com a fonte HttpIntake (sem porta serial,
// sem simulator), envia varios payloads JSON nao serializados (formato
// do ESP32) e verifica:
//   - Payload valido vira ProcessedSensorMessage canonico em /data/latest;
//   - Contadores em /metrics avancam corretamente (totalReceived,
//     sequenceGapMessages, totalInvalid);
//   - Payload fora do contrato retorna 400 e incrementa totalInvalid;
//   - Header X-Api-Key eh exigido quando API_KEY esta configurada (fluxo
//     desligado por default neste teste);
//   - Campos `wifi_rssi_dbm` e `wifi_reconnects` chegam ate a snapshot.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(here, "..", "..", "arquitetura-arduino-node-api", "backend");
const distDir = path.join(backendRoot, "dist");

function requireDist(rel) {
  return require(path.join(distDir, rel));
}

async function startHarness() {
  const express = require(path.join(backendRoot, "node_modules", "express"));
  const cors = require(path.join(backendRoot, "node_modules", "cors"));

  const { MetricsService } = requireDist("services/metricsService.js");
  const { ExperimentService } = requireDist("services/experimentService.js");
  const { SensorDataService } = requireDist("services/sensorDataService.js");
  const { SensorWebSocketServer } = requireDist("websocket/websocketServer.js");
  const { HttpIntake } = requireDist("http/httpIntake.js");
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
  const sensorInput = new HttpIntake();

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

  const baseUrl = `http://127.0.0.1:${address.port}`;
  sensorInput.start();

  return {
    baseUrl,
    services: { metricsService, experimentService, sensorDataService, sensorInput, websocketServer },
    async close() {
      experimentService.reset();
      try {
        const wss = websocketServer.websocketServer;
        if (wss && typeof wss.close === "function") {
          await new Promise((resolve) => wss.close(() => resolve()));
        }
      } catch { /* ignore */ }
      await new Promise((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  };
}

async function postJson(baseUrl, path, body) {
  return fetch(baseUrl + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function getJson(baseUrl, path) {
  const res = await fetch(baseUrl + path);
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

test("POST /ingest/sensor aceita payload valido e atualiza /metrics + /data/latest", async () => {
  const harness = await startHarness();
  try {
    const sample = {
      deviceId: "esp32-01",
      seq: 1,
      send_us: 1717000000000000,
      hr: 82,
      ax: 0.12,
      ay: -0.04,
      az: 0.98,
      wifi_rssi_dbm: -56,
      wifi_reconnects: 0
    };
    const response = await postJson(harness.baseUrl, "/ingest/sensor", sample);
    assert.equal(response.status, 204);

    const metrics = await getJson(harness.baseUrl, "/metrics");
    assert.equal(metrics.status, 200);
    assert.equal(metrics.body.totalMessagesReceived, 1);
    assert.equal(metrics.body.totalInvalidMessages, 0);
    assert.equal(metrics.body.lostMessages, 0);

    const latest = await getJson(harness.baseUrl, "/data/latest");
    assert.equal(latest.status, 200);
    assert.equal(latest.body.sensor.id, 1);
    assert.equal(latest.body.sensor.heartRate, 82);
    assert.equal(latest.body.sensor.acceleration.x, 0.12);
    assert.equal(latest.body.deviceId, "esp32-01");
    assert.equal(latest.body.wifiRssiDbm, -56);
    assert.equal(latest.body.wifiReconnects, 0);
  } finally {
    await harness.close();
  }
});

test("payload fora do contrato retorna 400 e incrementa totalInvalidMessages", async () => {
  const harness = await startHarness();
  try {
    const invalid = { deviceId: "esp32-01", seq: 1, hr: 999, ax: 0, ay: 0, az: 0, send_us: 1 };
    const response = await postJson(harness.baseUrl, "/ingest/sensor", invalid);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.accepted, false);

    const metrics = await getJson(harness.baseUrl, "/metrics");
    assert.equal(metrics.body.totalMessagesReceived, 0);
    assert.equal(metrics.body.totalInvalidMessages, 1);
  } finally {
    await harness.close();
  }
});

test("gap em seq vira sequenceGapMessages em /metrics", async () => {
  const harness = await startHarness();
  try {
    for (const seq of [1, 2, 5]) {
      const ok = await postJson(harness.baseUrl, "/ingest/sensor", {
        deviceId: "esp32-01",
        seq,
        send_us: 1717000000000000 + seq * 1000,
        hr: 82,
        ax: 0,
        ay: 0,
        az: 1
      });
      assert.equal(ok.status, 204);
    }
    const metrics = await getJson(harness.baseUrl, "/metrics");
    assert.equal(metrics.body.totalMessagesReceived, 3);
    assert.equal(metrics.body.sequenceGapMessages, 2);
    assert.equal(metrics.body.lostMessages, 2);
  } finally {
    await harness.close();
  }
});

test("GET /config retorna intervalMs corrente", async () => {
  const harness = await startHarness();
  try {
    const initial = await getJson(harness.baseUrl, "/config");
    assert.equal(initial.status, 200);
    assert.equal(typeof initial.body.intervalMs, "number");

    harness.services.sensorInput.setIntervalMs(250);
    const updated = await getJson(harness.baseUrl, "/config");
    assert.equal(updated.body.intervalMs, 250);
  } finally {
    await harness.close();
  }
});

test("/health.serial.source eh 'wifi-http' quando o intake recebeu uma amostra", async () => {
  const harness = await startHarness();
  try {
    await postJson(harness.baseUrl, "/ingest/sensor", {
      deviceId: "esp32-42",
      seq: 1,
      send_us: 1717000000000000,
      hr: 80,
      ax: 0,
      ay: 0,
      az: 1
    });
    const health = await getJson(harness.baseUrl, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.body.serial.source, "wifi-http");
    assert.equal(health.body.serial.connected, true);
    assert.equal(health.body.serial.lastDeviceId, "esp32-42");
  } finally {
    await harness.close();
  }
});
