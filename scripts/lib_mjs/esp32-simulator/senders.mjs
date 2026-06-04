// Senders do simulador: cada arquitetura encapsula sua propria forma
// de entregar o payload (POST HTTP para A1/A2/A3, publish para A4),
// expondo a mesma interface { name, endpoint, send, close }. Manter a
// interface uniforme permite que o runner de envio (runner.mjs) seja
// agnostico a transporte e gere metricas comparaveis -- o status do
// MQTT em QoS 0 eh mapeado para "ok"/"error" porque o protocolo nao
// tem codigo numerico equivalente ao HTTP.

import { performance } from "node:perf_hooks";

const DEFAULT_HTTP_TIMEOUT_MS = 5_000;

/**
 * @param {object} args
 * @param {"a1"|"a2"} args.architecture
 * @param {string} args.baseUrl - ex.: http://localhost:3000
 * @param {string} [args.apiKey]
 * @param {number} [args.timeoutMs]
 */
export function createBackendHttpSender({
  architecture,
  baseUrl,
  apiKey = "",
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
}) {
  const url = `${stripTrailingSlash(baseUrl)}/ingest/sensor`;
  return createHttpSender({
    name: architecture.toUpperCase(),
    url,
    apiKey,
    timeoutMs,
  });
}

/**
 * @param {object} args
 * @param {string} args.baseUrl - ex.: http://localhost:3001 (vercel dev) ou https://...vercel.app
 * @param {string} [args.apiKey]
 * @param {number} [args.timeoutMs]
 */
export function createServerlessHttpSender({
  baseUrl,
  apiKey = "",
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
}) {
  const url = `${stripTrailingSlash(baseUrl)}/api/ingest`;
  return createHttpSender({ name: "A3", url, apiKey, timeoutMs });
}

// O pacote `mqtt` so eh requerido por A4. Importacao dinamica para que
// quem rode apenas A1/A2/A3 nao precise instalar a dependencia. Quando
// faltar, devolvemos um sender de erro acionavel para que a campanha
// reporte o problema no log em vez de falhar no boot.
export async function createMqttSender({
  brokerUrl,
  deviceId,
  topicTemplate = "clube/{deviceId}/sensor",
  username,
  password,
  qos = 0,
}) {
  let mqtt;
  try {
    mqtt = await import("mqtt");
  } catch (err) {
    return {
      name: "A4",
      endpoint: `${brokerUrl} (mqtt nao instalado)`,
      async send() {
        return {
          status: "error",
          rttMs: 0,
          error:
            "pacote 'mqtt' nao instalado. Instale com 'npm install mqtt' na raiz " +
            "ou em arquitetura-mqtt/bridge/ antes de rodar --architecture a4.",
        };
      },
      async close() {},
    };
  }

  const topic = topicTemplate.replace("{deviceId}", deviceId);
  const client = mqtt.connect(brokerUrl, {
    username,
    password,
    reconnectPeriod: 1000,
    connectTimeout: 10_000,
  });

  await new Promise((resolve, reject) => {
    const onConnect = () => {
      client.off("error", onError);
      resolve();
    };
    const onError = (err) => {
      client.off("connect", onConnect);
      reject(err);
    };
    client.once("connect", onConnect);
    client.once("error", onError);
  });

  return {
    name: "A4",
    endpoint: `${brokerUrl} ${topic}`,
    async send(payload) {
      const t0 = performance.now();
      return new Promise((resolve) => {
        client.publish(
          topic,
          JSON.stringify(payload),
          { qos },
          (err) => {
            const rttMs = performance.now() - t0;
            if (err) {
              resolve({ status: "error", rttMs, error: err.message });
            } else {
              resolve({ status: "ok", rttMs });
            }
          }
        );
      });
    },
    async close() {
      await new Promise((resolve) => client.end(false, {}, () => resolve()));
    },
  };
}

function createHttpSender({ name, url, apiKey, timeoutMs }) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["X-Api-Key"] = apiKey;

  return {
    name,
    endpoint: url,
    async send(payload) {
      const t0 = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const rttMs = performance.now() - t0;
        // Drenar o body eh obrigatorio para o keep-alive do undici
        // liberar o socket. Sem isso, em rajadas curtas o pool fica
        // saturado e gera latencia espuria nas amostras finais.
        try {
          await response.arrayBuffer();
        } catch {
          /* ignore */
        }
        return { status: response.status, rttMs };
      } catch (err) {
        const rttMs = performance.now() - t0;
        return {
          status: "network_error",
          rttMs,
          error: err.name === "AbortError" ? `timeout_${timeoutMs}ms` : err.message,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      /* fetch nao mantem estado a fechar */
    },
  };
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}
