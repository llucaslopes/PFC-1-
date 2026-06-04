// Helpers de gerenciamento de subprocessos compartilhados pelos
// controllers do orquestrador (bridge MQTT, broker MQTT, simulador
// ESP32, backend, serverless). Centralizar aqui evita que cada novo
// controller copie e cole a mesma rotina de prefixOutput / kill / wait,
// que ja foi fonte de divergencia sutil entre versoes.

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

/**
 * Repassa stdout/stderr de um filho linha-a-linha prefixando com um
 * rotulo. Permite que varios subprocessos compartilhem o mesmo terminal
 * sem misturar saidas e sem perder o contexto de qual processo emitiu
 * cada linha.
 *
 * @param {string} label
 * @param {NodeJS.WritableStream} stream
 * @param {Buffer|string} chunk
 */
export function prefixOutput(label, stream, chunk) {
  const lines = chunk.toString().split(/\r?\n/);
  for (const line of lines) {
    if (line.trim().length > 0) {
      stream.write(`[${label}] ${line}\n`);
    }
  }
}

/**
 * Encerra um subprocesso e seus descendentes. No Windows usamos
 * `taskkill /T` porque `child.kill()` so envia o sinal para o filho
 * direto -- isso deixa orfaos quando o filho eh um wrapper de shell
 * (npm.cmd, powershell, etc.). Em POSIX usamos o grupo de processo
 * (PGID = -pid) quando o filho foi spawnado com `detached: true`.
 *
 * @param {import('node:child_process').ChildProcess|null|undefined} child
 */
export function killProcessTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/**
 * Aguarda o subprocesso terminar ou estourar o timeout. Resolve em
 * qualquer um dos dois casos -- caller decide se o exit ja aconteceu
 * inspecionando `child.exitCode` depois.
 *
 * @param {import('node:child_process').ChildProcess|null|undefined} child
 * @param {number} [timeoutMs=5000]
 */
export async function waitForExit(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve())),
    sleep(timeoutMs),
  ]);
}
