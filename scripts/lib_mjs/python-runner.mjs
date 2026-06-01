
/**
 * Helper para invocar scripts Python a partir dos orquestradores .mjs.
 *
 * Centraliza o `runPython` que era duplicado em `run-experiments.mjs`,
 * `run-scalability-campaign.mjs` e `run-multiclient-scalability.mjs`.
 *
 * Resolve `python` em Windows e `python3` em outros sistemas; stdio
 * herdado para tee transparente.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = resolve(__dirname, '..');

export function runPython(scriptName, args = [], { cwd } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pythonCmd, [resolve(SCRIPTS_DIR, scriptName), ...args], {
      stdio: 'inherit',
      shell: false,
      cwd,
    });
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${scriptName} saiu com codigo ${code}`));
    });
    child.on('error', rejectRun);
  });
}
