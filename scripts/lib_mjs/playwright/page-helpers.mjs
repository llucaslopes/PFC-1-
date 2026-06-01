
/**
 * Helpers de interacao com paginas Playwright especificos do prototipo
 * WebSerial. Extraido de `lib/webserial-runner.mjs:130-194`.
 *
 *   - `setNumberInput`: simula input + change em <input type="number">.
 *   - `waitForLogContains`: espera texto aparecer em #log.
 *   - `waitForCampaignDone`: espera "Campanha concluida" em #experimentStatus.
 *   - `captureDownloads`: registra handler de download, espera N arquivos,
 *     salva em `resultsDir`.
 *
 * Pode ser reusado em outras paginas que sigam o mesmo padrao de seletores
 * (`#log`, `#experimentStatus`, etc.).
 */

import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function setNumberInput(page, selector, value) {
  await page.evaluate(
    ({ sel, val }) => {
      const input = document.querySelector(sel);
      if (!input) return;
      input.value = String(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { sel: selector, val: value }
  );
}

export async function waitForLogContains(page, text, timeoutMs) {
  await page.waitForFunction(
    (expected) => {
      const log = document.querySelector('#log');
      return log && log.textContent.includes(expected);
    },
    text,
    { timeout: timeoutMs }
  );
}

export async function waitForCampaignDone(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector('#experimentStatus');
      return status && status.textContent.includes('Campanha concluida');
    },
    null,
    { timeout: timeoutMs }
  );
}

export async function captureDownloads({ page, expectedCount, resultsDir, timeoutMs }) {
  const saved = [];
  const downloadPromises = [];

  const handler = (download) => {
    const filename = download.suggestedFilename();
    const target = path.join(resultsDir, filename);
    const promise = download
      .saveAs(target)
      .then(() => {
        saved.push(target);
        console.log(`[orchestrator]   download salvo: ${filename}`);
      })
      .catch((error) => {
        console.warn(`[orchestrator]   falha no download ${filename}: ${error.message}`);
      });
    downloadPromises.push(promise);
  };

  page.on('download', handler);

  const startedAt = Date.now();
  while (downloadPromises.length < expectedCount && Date.now() - startedAt < timeoutMs) {
    await sleep(250);
  }

  await Promise.all(downloadPromises);
  page.off('download', handler);
  return saved;
}
