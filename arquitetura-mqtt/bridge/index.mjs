// Bridge da arquitetura A4. Recebe mensagens publicadas no broker MQTT
// e expoe o mesmo contrato HTTP/WebSocket do backend Node (A1/A2),
// importando os modulos compilados do backend (dist/) em vez de
// reimplementa-los. Essa simbiose tem um proposito metodologico: o
// pipeline de processamento (validacao, metricas, experiment service,
// broadcast WebSocket) eh literalmente o mesmo nas duas arquiteturas,
// entao qualquer diferenca observada na comparacao vem do transporte
// de entrada (POST HTTP em A1/A2 vs publish/subscribe em A4) e nao de
// implementacao. Pre-requisito: rodar `npm run build` no backend antes.

import http from "node:http";
import net from "node:net";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import cors from "cors";
import express from "express";
import mqtt from "mqtt";

import { MqttIntake } from "./mqttIntake.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = resolve(here, "..", "..", "arquitetura-arduino-node-api", "backend");
const BACKEND_DIST = resolve(BACKEND_ROOT, "dist");
const BACKEND_PUBLIC = resolve(BACKEND_ROOT, "public");

// Arquivos compilados do backend Node que a bridge importa em runtime.
// Manter o caminho relativo (./services/...) facilita ler os imports
// abaixo lado a lado com a checagem de existencia.
const REQUIRED_BACKEND_MODULES = [
  "services/sensorDataService.js",
  "services/metricsService.js",
  "services/experimentService.js",
  "websocket/websocketServer.js",
  "http/routes.js",
];

// Importa os modulos compilados do backend Node, falhando cedo (e com
// mensagem acionavel) quando o operador esquecer de rodar `npm run
// build`. Centralizar verificacao + import evita estado intermediario:
// se um arquivo existir mas outro nao, a falha vinha de `import()`
// quando o caller ja tinha avancado.
async function loadBackendModulesOrFail() {
  const missing = REQUIRED_BACKEND_MODULES.filter(
    (file) => !existsSync(join(BACKEND_DIST, file))
  );
  if (missing.length > 0) {
    throw new Error(
      "Backend nao compilado. Rode 'npm run build' em arquitetura-arduino-node-api/backend/ antes de subir a bridge. " +
        `Arquivos faltando em ${BACKEND_DIST}: ${missing.join(", ")}`
    );
  }
  const [
    { SensorDataService },
    { MetricsService },
    { ExperimentService },
    { SensorWebSocketServer },
    { createRoutes },
  ] = await Promise.all(
    REQUIRED_BACKEND_MODULES.map((relPath) =>
      import(pathToFileURL(join(BACKEND_DIST, relPath)).href)
    )
  );
  return { SensorDataService, MetricsService, ExperimentService, SensorWebSocketServer, createRoutes };
}

function readEnv(name, fallback) {
  const v = process.env[name];
  return v != null && v !== "" ? v : fallback;
}

function isTrueLike(value) {
  if (value == null) return false;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

// Broker embarcado para dev e CI. NAO deve ser usado na campanha
// oficial: o aedes vive no mesmo event loop da bridge, entao broker e
// consumidor compartilham CPU e ganham um vies favoravel a A4 que
// nao se reproduz com Mosquitto em outro processo (ou em outra
// maquina). A campanha oficial usa o docker-compose da pasta.
async function startEmbeddedBroker({ port = 1883 } = {}) {
  const { default: Aedes } = await import("aedes");
  const aedes = new Aedes();
  const server = net.createServer(aedes.handle);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });
  console.log(`[mqtt-bridge] broker EMBARCADO (aedes) em mqtt://localhost:${port} (dev/CI; nao usar em campanha oficial).`);
  return {
    port,
    async stop() {
      await new Promise((res) => server.close(() => res()));
      await new Promise((res) => aedes.close(() => res()));
    },
  };
}

// Handler de cada mensagem que chega pela assinatura MQTT. Extraido do
// main() para que (a) o tratamento de erro de parse e o caminho feliz
// fiquem testaveis em isolamento e (b) o callback do client fique
// pequeno o suficiente para uma leitura linear.
function handleMqttMessage({ topic, payloadBuf, sensorDataService, mqttIntake }) {
  let payload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8"));
  } catch (err) {
    mqttIntake.markError(`json_parse: ${err.message}`);
    console.warn(`[mqtt-bridge] payload nao-JSON em ${topic}: ${err.message}`);
    return;
  }
  const result = sensorDataService.processJsonPayload(payload);
  if (!result) return;
  if (result.accepted) {
    mqttIntake.markIngested(typeof payload.deviceId === "string" ? payload.deviceId : null);
    return;
  }
  mqttIntake.markError(`payload_rejected: ${result.reason ?? "unknown"}`);
}

async function main() {
  const port = Number(readEnv("BRIDGE_PORT", "4002")) || 4002;
  const brokerUrl = readEnv("MQTT_URL", "mqtt://localhost:1883");
  const topic = readEnv("MQTT_TOPIC", "iot/+/sensor");
  const qos = Number(readEnv("MQTT_QOS", "0")) || 0;
  const username = readEnv("MQTT_USERNAME", "") || undefined;
  const password = readEnv("MQTT_PASSWORD", "") || undefined;
  const useEmbeddedBroker = isTrueLike(readEnv("MQTT_EMBEDDED_BROKER", ""));
  const embeddedBrokerPort = Number(readEnv("MQTT_EMBEDDED_BROKER_PORT", "1883")) || 1883;

  let embeddedBroker = null;
  if (useEmbeddedBroker) {
    embeddedBroker = await startEmbeddedBroker({ port: embeddedBrokerPort });
  }

  const { SensorDataService, MetricsService, ExperimentService, SensorWebSocketServer, createRoutes } =
    await loadBackendModulesOrFail();

  const app = express();
  const httpServer = http.createServer(app);

  const metricsService = new MetricsService();
  const experimentService = new ExperimentService(metricsService);
  const sensorDataService = new SensorDataService(
    metricsService,
    experimentService,
    () => experimentService.getCurrentClockSync()
  );
  const websocketServer = new SensorWebSocketServer(httpServer);
  const mqttIntake = new MqttIntake();

  app.use(cors());
  app.use(express.json({ limit: "25mb" }));
  // O dashboard estatico tambem eh emprestado do backend Node. Isso
  // permite que um unico frontend, configurado por baseUrl, sirva A1,
  // A2 e A4 -- evita manter tres dashboards em paralelo, o que era
  // fonte recorrente de divergencia visual entre arquiteturas.
  if (existsSync(BACKEND_PUBLIC)) {
    app.use(express.static(BACKEND_PUBLIC));
    console.log(`[mqtt-bridge] dashboard estatico servido a partir de ${BACKEND_PUBLIC}`);
  } else {
    console.warn(`[mqtt-bridge] dashboard estatico ausente (${BACKEND_PUBLIC}); rotas REST/WS continuam disponiveis.`);
  }
  app.use(
    createRoutes({
      metricsService,
      experimentService,
      sensorDataService,
      serialReader: mqttIntake,
      websocketServer,
    })
  );

  sensorDataService.onMessage((message) => {
    websocketServer.broadcastSensorMessage(message);
  });

  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    reconnectPeriod: 1_000,
    connectTimeout: 10_000,
  });

  client.on("connect", () => {
    console.log(`[mqtt-bridge] conectado em ${brokerUrl}; assinando ${topic} (qos=${qos}).`);
    client.subscribe(topic, { qos }, (err) => {
      if (err) {
        console.error(`[mqtt-bridge] falha ao assinar ${topic}: ${err.message}`);
      }
    });
  });

  client.on("error", (err) => {
    mqttIntake.markError(err.message);
    console.error(`[mqtt-bridge] erro MQTT: ${err.message}`);
  });

  client.on("reconnect", () => {
    console.log(`[mqtt-bridge] reconectando em ${brokerUrl}...`);
  });

  client.on("message", (topic, payloadBuf) =>
    handleMqttMessage({ topic, payloadBuf, sensorDataService, mqttIntake })
  );

  httpServer.listen(port, () => {
    mqttIntake.start();
    console.log(`[mqtt-bridge] HTTP/WS em http://localhost:${port}`);
    console.log(
      "[mqtt-bridge] Endpoints (compativeis com o backend A1/A2): GET /health, GET /data/latest, GET /metrics, POST /experiments/{start,stop,reset,observations}, GET /experiments/{current,export}."
    );
    console.log(`[mqtt-bridge] WebSocket: ws://localhost:${port}`);
  });

  const shutdown = (signal) => {
    console.log(`[mqtt-bridge] sinal ${signal}; encerrando.`);
    try {
      client.end(false);
    } catch {
      /* ignore */
    }
    if (embeddedBroker) {
      embeddedBroker.stop().catch(() => {});
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[mqtt-bridge] ERRO: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
