import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function prefixOutput(label, stream, chunk) {
  const lines = chunk.toString().split(/\r?\n/);

  for (const line of lines) {
    if (line.trim().length > 0) {
      stream.write(`[${label}] ${line}\n`);
    }
  }
}

async function probeReady({ url, timeoutMs, predicate }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: "no-store" });

      if (response.ok) {
        if (!predicate) {
          return true;
        }

        const payload = await response.json().catch(() => null);

        if (predicate(payload)) {
          return true;
        }
      }
    } catch {
      // server still starting
    }

    await sleep(500);
  }

  return false;
}

function killProcessTree(child) {
  if (!child || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function waitForExit(child, timeoutMs = 10_000) {
  if (!child || child.exitCode !== null) {
    return;
  }

  await Promise.race([
    new Promise((resolveExit) => child.once("exit", () => resolveExit())),
    sleep(timeoutMs)
  ]);
}

export async function startBackend({
  source = "serial",
  serialPort = process.env.SERIAL_PORT ?? "COM3",
  port = 3000,
  readyTimeoutMs = 45_000
} = {}) {
  const cwd = resolve(rootDir, "arquitetura-arduino-node-api", "backend");
  const env = {
    ...process.env,
    SENSOR_SOURCE: source,
    PORT: String(port)
  };

  if (source === "serial") {
    env.SERIAL_PORT = serialPort;
  } else {
    delete env.SERIAL_PORT;
  }

  console.log(
    `[orchestrator] Iniciando backend (source=${source}${source === "serial" ? `, port=${serialPort}` : ""}) em :${port}.`
  );

  const child = spawn("npm", ["run", "dev"], {
    cwd,
    shell: true,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  child.stdout.on("data", (chunk) => prefixOutput("backend", process.stdout, chunk));
  child.stderr.on("data", (chunk) => prefixOutput("backend", process.stderr, chunk));

  const ready = await probeReady({
    url: `http://localhost:${port}/health`,
    timeoutMs: readyTimeoutMs,
    predicate: (payload) => payload?.status === "ok"
  });

  if (!ready) {
    killProcessTree(child);
    throw new Error(`Backend nao ficou pronto em ${readyTimeoutMs} ms.`);
  }

  console.log(`[orchestrator] Backend pronto em http://localhost:${port}`);

  return { child, label: "backend", port };
}

export async function startWebserial({ port = 8765, readyTimeoutMs = 20_000 } = {}) {
  const cwd = resolve(rootDir, "prototypes", "webserial");

  console.log(`[orchestrator] Iniciando webserial em :${port}.`);

  const child = spawn("npm", ["start"], {
    cwd,
    shell: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32"
  });

  child.stdout.on("data", (chunk) => prefixOutput("webserial", process.stdout, chunk));
  child.stderr.on("data", (chunk) => prefixOutput("webserial", process.stderr, chunk));

  const ready = await probeReady({
    url: `http://localhost:${port}/`,
    timeoutMs: readyTimeoutMs
  });

  if (!ready) {
    killProcessTree(child);
    throw new Error(`Webserial nao ficou pronto em ${readyTimeoutMs} ms.`);
  }

  console.log(`[orchestrator] Webserial pronto em http://localhost:${port}/`);

  return { child, label: "webserial", port };
}

export async function stop(handle) {
  if (!handle?.child) {
    return;
  }

  console.log(`[orchestrator] Encerrando ${handle.label}.`);
  killProcessTree(handle.child);
  await waitForExit(handle.child);
}
