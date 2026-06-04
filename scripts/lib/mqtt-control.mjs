// Lifecycle do broker MQTT (Mosquitto) e da bridge HTTP que coleta as
// mensagens publicadas. Sao processos separados porque cumprem papeis
// distintos: o broker eh infraestrutura (vale manter rodando entre
// rodadas para evitar custo de subida do container), enquanto a bridge
// precisa reiniciar a cada campanha para zerar contadores e nao
// contaminar a rep seguinte com amostras antigas.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { killProcessTree, prefixOutput, waitForExit } from "./process-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MQTT_DIR = resolve(rootDir, "arquitetura-mqtt");
const BRIDGE_DIR = resolve(MQTT_DIR, "bridge");

async function waitForHttp(url, { timeoutMs = 20_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok) return true;
      lastError = `status_${res.status}`;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout esperando ${url}: ${lastError ?? "sem resposta"}`);
}

async function isPortInUse(port) {
  try {
    const net = await import("node:net");
    return await new Promise((res) => {
      const s = net.createConnection({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.destroy();
        res(true);
      });
      s.once("error", () => res(false));
    });
  } catch {
    return false;
  }
}

async function tryDockerComposeUp() {
  return await new Promise((res) => {
    const child = spawn(
      process.platform === "win32" ? "docker.exe" : "docker",
      ["compose", "up", "-d", "mosquitto"],
      { cwd: MQTT_DIR, stdio: ["ignore", "pipe", "pipe"], shell: false }
    );
    let stderrAcc = "";
    child.stdout.on("data", (c) => prefixOutput("mosquitto", process.stdout, c));
    child.stderr.on("data", (c) => {
      stderrAcc += c.toString();
      prefixOutput("mosquitto", process.stderr, c);
    });
    child.once("error", (err) => res({ ok: false, reason: err.message }));
    child.once("exit", (code) => {
      if (code === 0) res({ ok: true });
      else res({ ok: false, reason: stderrAcc || `exit=${code}` });
    });
  });
}

// Estrategia em tres camadas para subir o broker, do mais "real" para
// o mais "leve":
//   1. Se algo ja escuta em :1883, assume que o operador subiu o broker
//      manualmente (Mosquitto local, broker dedicado) e nao mexe.
//   2. Tenta `docker compose up -d mosquitto` -- caminho oficial usado
//      na campanha do TCC, garante isolamento do broker.
//   3. Cai para um broker embarcado (aedes) hospedado no proprio
//      processo da bridge. So serve para dev/CI: as latencias de
//      publish/subscribe sao diferentes das de um broker dedicado e
//      nao devem ser usadas no relatorio.
export async function startMqttBroker({ skipIfRunning = true } = {}) {
  if (skipIfRunning && (await isPortInUse(1883))) {
    console.log("[orchestrator] Broker MQTT ja em :1883; nao subindo nada.");
    return { kind: "external", startedByUs: false, env: {} };
  }

  console.log(`[orchestrator] Tentando Mosquitto via docker compose em ${MQTT_DIR}.`);
  const docker = await tryDockerComposeUp();
  if (docker.ok) {
    return { kind: "docker", startedByUs: true, env: {} };
  }

  console.warn(
    `[orchestrator] docker compose falhou (${(docker.reason ?? "sem razao").split("\n")[0]}). ` +
      "Caindo para broker EMBARCADO (aedes) na bridge para nao bloquear A4. " +
      "Use Docker para campanha oficial."
  );
  return {
    kind: "embedded",
    startedByUs: true,
    env: { MQTT_EMBEDDED_BROKER: "true", MQTT_EMBEDDED_BROKER_PORT: "1883" },
  };
}

export async function stopMqttBroker(handle, { remove = false } = {}) {
  if (!handle || !handle.startedByUs) return;
  // O broker embarcado vive dentro do processo da bridge, entao morre
  // automaticamente quando a bridge eh encerrada -- nao precisa de
  // teardown explicito aqui.
  if (handle.kind === "embedded") return;
  if (handle.kind !== "docker") return;
  const args = remove ? ["compose", "down"] : ["compose", "stop", "mosquitto"];
  console.log(`[orchestrator] Encerrando Mosquitto (docker ${args.join(" ")}).`);
  const child = spawn(
    process.platform === "win32" ? "docker.exe" : "docker",
    args,
    { cwd: MQTT_DIR, stdio: "ignore", shell: false }
  );
  await new Promise((res) => {
    child.once("exit", () => res());
    child.once("error", () => res());
  });
}

// Sobe a bridge e bloqueia ate que /health responda. Sem essa barreira,
// o orquestrador entraria no startExperiment antes da bridge estar
// pronta para receber a primeira mensagem MQTT, gerando perda de
// amostras logo no boot.
export async function startMqttBridge({
  port = 4002,
  brokerUrl = "mqtt://localhost:1883",
  topic = "clube/+/sensor",
  qos = 0,
  readyTimeoutMs = 30_000,
  extraEnv = {},
} = {}) {
  console.log(`[orchestrator] Iniciando bridge MQTT em :${port} (broker=${brokerUrl}).`);
  const env = {
    ...process.env,
    BRIDGE_PORT: String(port),
    MQTT_URL: brokerUrl,
    MQTT_TOPIC: topic,
    MQTT_QOS: String(qos),
    ...extraEnv,
  };
  // process.execPath em vez de "npm start": a casca npm.cmd no Windows
  // gera "spawn EINVAL" intermitente e adiciona uma camada de processo
  // que dificulta o killProcessTree.
  const child = spawn(
    process.execPath,
    ["index.mjs"],
    { cwd: BRIDGE_DIR, env, stdio: ["ignore", "pipe", "pipe"], shell: false, detached: process.platform !== "win32" }
  );
  child.stdout.on("data", (c) => prefixOutput("bridge", process.stdout, c));
  child.stderr.on("data", (c) => prefixOutput("bridge", process.stderr, c));

  const baseUrl = `http://localhost:${port}`;
  try {
    await waitForHttp(`${baseUrl}/health`, { timeoutMs: readyTimeoutMs });
  } catch (err) {
    killProcessTree(child);
    await waitForExit(child, 2_000);
    throw err;
  }
  console.log(`[orchestrator] Bridge MQTT pronta em ${baseUrl}.`);
  return { child, baseUrl };
}

export async function stopMqttBridge(handle, { graceMs = 2_000 } = {}) {
  if (!handle?.child) return;
  if (handle.child.exitCode !== null) return;
  console.log("[orchestrator] Encerrando bridge MQTT.");
  killProcessTree(handle.child);
  await waitForExit(handle.child, Math.max(2_000, graceMs));
}
