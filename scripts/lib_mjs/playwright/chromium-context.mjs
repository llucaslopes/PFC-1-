
/**
 * Helpers Playwright/Chromium para automacao do prototipo WebSerial.
 *
 * Extraido de `lib/webserial-runner.mjs:9-128`:
 *   - `loadPlaywright`: import lazy com mensagem amigavel.
 *   - `launchContext`: launchPersistentContext + monkeypatch de
 *     navigator.serial.requestPort para auto-selecionar primeira porta
 *     autorizada.
 *   - `bootstrapSerialPermission`: abre Chrome para o usuario clicar e
 *     autorizar a porta serial 1 unica vez; perfil persistente.
 *   - `hasSerialPermission`: checa em headless se ja tem porta autorizada.
 *
 * Nenhuma logica de teste/coleta aqui — esses helpers sao reutilizaveis em
 * qualquer automacao Playwright que precise da Web Serial API.
 */

import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const SERIAL_PERMISSION_POLL_MS = 1000;
const SERIAL_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      "Playwright nao esta instalado. Rode 'npm install' e 'npx playwright install chromium' antes."
    );
  }
}

export async function launchContext({ userDataDir, headless = false, downloadsPath } = {}) {
  const { chromium } = await loadPlaywright();
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
    downloadsPath,
    args: [
      '--enable-blink-features=Serial',
      '--no-default-browser-check',
      '--no-first-run',
    ],
  });

  await context.addInitScript(() => {
    if (!navigator.serial || navigator.serial.__pfcPatched) {
      return;
    }
    navigator.serial.__pfcPatched = true;
    const originalRequestPort = navigator.serial.requestPort.bind(navigator.serial);
    navigator.serial.requestPort = async function patchedRequestPort(options) {
      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length > 0) {
          return ports[0];
        }
      } catch (_) {
        /* fall through */
      }
      return originalRequestPort(options);
    };
  });

  return context;
}

async function waitForSerialPermissionOnContext({ context, baseUrl }) {
  const page = await context.newPage();
  await page.goto(baseUrl);

  const deadline = Date.now() + SERIAL_PERMISSION_TIMEOUT_MS;
  let granted = false;

  while (Date.now() < deadline) {
    const portCount = await page
      .evaluate(async () => {
        if (!navigator.serial) return 0;
        const ports = await navigator.serial.getPorts();
        return ports.length;
      })
      .catch(() => 0);

    if (portCount > 0) {
      granted = true;
      break;
    }
    await sleep(SERIAL_PERMISSION_POLL_MS);
  }

  await page.close().catch(() => {});

  if (!granted) {
    throw new Error(
      "Timeout esperando autorizacao da porta serial. Conecte o Arduino e clique em 'Conectar serial', ou rode com --no-auto-bootstrap para abortar imediatamente."
    );
  }

  console.log('[orchestrator] Permissao salva no perfil persistente.');
  return true;
}

export async function bootstrapSerialPermission({
  baseUrl = 'http://localhost:8765/',
  userDataDir,
}) {
  console.log('[orchestrator] Bootstrap WebSerial: abrindo Chrome para autorizar a porta serial.');
  console.log("[orchestrator] => Clique em 'Conectar serial' e selecione a porta COMx do Arduino.");
  console.log('[orchestrator]    O script fecha o navegador sozinho assim que detectar permissao.');

  const context = await launchContext({ userDataDir });
  try {
    return await waitForSerialPermissionOnContext({ context, baseUrl });
  } finally {
    await context.close();
  }
}

export async function hasSerialPermission({
  baseUrl = 'http://localhost:8765/',
  userDataDir,
}) {
  const context = await launchContext({ userDataDir, headless: true });
  try {
    const page = await context.newPage();
    await page.goto(baseUrl);
    const count = await page
      .evaluate(async () => {
        if (!navigator.serial) return 0;
        const ports = await navigator.serial.getPorts();
        return ports.length;
      })
      .catch(() => 0);
    return count > 0;
  } finally {
    await context.close();
  }
}
