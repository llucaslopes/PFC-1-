import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const npmCommand = 'npm';
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Sobe os servidores de desenvolvimento das arquiteturas A1/A2 (backend
// Node) e A3 (serverless via `vercel dev`). A4 (MQTT) e tratado em
// `arquitetura-mqtt/` separadamente, apenas quando habilitado.
const apps = [
  {
    name: 'backend',
    cwd: 'arquitetura-arduino-node-api/backend',
    args: ['run', 'dev'],
  },
  {
    name: 'serverless',
    cwd: 'arquitetura-serverless',
    args: ['run', 'dev'],
  },
];

const children = [];
let isShuttingDown = false;

function prefixOutput(appName, stream, chunk) {
  const lines = chunk.toString().split(/\r?\n/);

  for (const line of lines) {
    if (line.trim().length > 0) {
      stream.write(`[${appName}] ${line}\n`);
    }
  }
}

function stopAll(exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }

  process.exit(exitCode);
}

for (const app of apps) {
  const child = spawn(npmCommand, app.args, {
    cwd: resolve(rootDir, app.cwd),
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.push(child);

  child.stdout.on('data', (chunk) => prefixOutput(app.name, process.stdout, chunk));
  child.stderr.on('data', (chunk) => prefixOutput(app.name, process.stderr, chunk));

  child.on('exit', (code, signal) => {
    if (!isShuttingDown) {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      console.error(`[${app.name}] process finished with ${reason}`);
      stopAll(code ?? 1);
    }
  });
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
