// Controle do simulador local do ESP32. Usado quando o ESP32 fisico
// nao esta disponivel (--source simulator-http): o backend/serverless
// segue rodando exatamente como na campanha real, e o simulador
// alimenta os endpoints com a mesma estrutura de payload do firmware.
// O objetivo nao eh substituir o ESP32 nas medidas oficiais, e sim
// permitir reexecutar o pipeline em CI ou em maquinas sem hardware
// quando se quer validar mudancas no orquestrador ou no backend.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { killProcessTree, prefixOutput, waitForExit } from "./process-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIMULATOR_SCRIPT = resolve(rootDir, "scripts", "esp32-simulator.mjs");

/**
 * @param {object} args
 * @param {"a1"|"a2"|"a3"|"a4"} args.architecture
 * @param {string} args.baseUrl
 * @param {number} args.intervalMs
 * @param {number} args.durationSec
 * @param {string} [args.deviceId]
 * @param {string} [args.apiKey]
 * @param {string} [args.brokerUrl]
 * @param {string} [args.mqttTopic]
 * @param {string} [args.label]
 */
export function startEsp32Simulator({
  architecture,
  baseUrl,
  intervalMs,
  durationSec,
  deviceId = "esp32-01",
  apiKey,
  brokerUrl,
  mqttTopic,
  label = "esp32-sim",
}) {
  if (!architecture) throw new Error("startEsp32Simulator: architecture obrigatorio.");
  if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("startEsp32Simulator: intervalMs invalido.");
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("startEsp32Simulator: durationSec invalido.");
  }

  const cliArgs = [
    SIMULATOR_SCRIPT,
    "--architecture",
    architecture,
    "--device-id",
    deviceId,
    "--interval-ms",
    String(intervalMs),
    "--duration-sec",
    String(durationSec),
  ];
  if (baseUrl) {
    cliArgs.push("--base-url", baseUrl);
  }
  if (apiKey) {
    cliArgs.push("--api-key", apiKey);
  }
  if (architecture === "a4") {
    if (brokerUrl) cliArgs.push("--broker-url", brokerUrl);
    if (mqttTopic) cliArgs.push("--topic", mqttTopic);
  }

  console.log(
    `[orchestrator] Subindo esp32-simulator (arch=${architecture}, interval=${intervalMs}ms, duration=${durationSec}s${baseUrl ? `, base=${baseUrl}` : ""}${brokerUrl ? `, broker=${brokerUrl}` : ""}).`
  );

  const child = spawn(process.execPath, cliArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  child.stdout.on("data", (chunk) => prefixOutput(label, process.stdout, chunk));
  child.stderr.on("data", (chunk) => prefixOutput(label, process.stderr, chunk));

  return { child, label };
}

export async function stopEsp32Simulator(handle, { graceMs = 1_000 } = {}) {
  if (!handle?.child) return;
  if (handle.child.exitCode !== null) return;
  console.log(`[orchestrator] Encerrando ${handle.label}.`);
  killProcessTree(handle.child);
  await waitForExit(handle.child, Math.max(1000, graceMs));
}

// Versao "espera natural": o orquestrador chama isso quando quer
// apenas que a janela de envio do simulador termine sozinha (caso
// em que o --duration-sec do simulador casa com o durationSeconds
// da rep). Sem isso, o teardown teria que matar o processo no meio
// do envio, gerando logs de erro confusos.
export async function awaitEsp32SimulatorExit(handle, { timeoutMs = 60_000 } = {}) {
  if (!handle?.child) return;
  await waitForExit(handle.child, timeoutMs);
}
