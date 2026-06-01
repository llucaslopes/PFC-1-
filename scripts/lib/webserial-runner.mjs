
/**
 * Orquestrador WebSerial: automatiza o prototipo via Playwright para coletar
 * 1 campanha completa (N intervalos em sequencia) por replicacao, depois
 * baixa os 4 arquivos exportados pela pagina.
 *
 * Refatorado na Sub-fase 2.5 (398 -> ~190 linhas): helpers Chromium em
 * `lib_mjs/playwright/chromium-context.mjs`, helpers DOM em
 * `lib_mjs/playwright/page-helpers.mjs`. Schema dos arquivos baixados
 * (sensor-data.csv, metrics.csv, campaign-summary.csv,
 * experiment-summary.json) e definido pela pagina HTML — esta refatoracao
 * nao toca em nenhum frontend.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  bootstrapSerialPermission,
  hasSerialPermission,
  launchContext,
} from '../lib_mjs/playwright/chromium-context.mjs';
import {
  captureDownloads,
  setNumberInput,
  waitForCampaignDone,
  waitForLogContains,
} from '../lib_mjs/playwright/page-helpers.mjs';
import { createHeartbeat, isRepComplete } from './runtime-utils.mjs';

// Re-export para compatibilidade com chamadores existentes
// (`run-experiments.mjs`, `run-multiclient-scalability.mjs`).
export { bootstrapSerialPermission, hasSerialPermission };

export async function runWebserialCampaign({
  baseUrl = 'http://localhost:8765/',
  source = 'serial',
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [100, 50, 20, 10, 5, 1],
  campaignType = 'official',
  resultsDir = 'resultados',
  userDataDir,
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000,
} = {}) {
  await fs.mkdir(resultsDir, { recursive: true });
  const absoluteResultsDir = path.resolve(resultsDir);
  const lastIntervalMs = intervalsMs[intervalsMs.length - 1];

  for (let rep = 1; rep <= reps; rep++) {
    console.log(
      `\n[orchestrator] ======= WEBSERIAL / source=${source} / rep ${rep}/${reps} =======`
    );

    if (resume) {
      const alreadyDone = await isRepComplete({
        resultsDir: absoluteResultsDir,
        architecture: 'webserial',
        communicationMode: 'webserial',
        source, lastIntervalMs, rep, campaignType,
      });
      if (alreadyDone) {
        console.log(
          `[orchestrator] rep ${rep} ja possui experiment-summary.json em ${absoluteResultsDir}; pulando (resume).`
        );
        continue;
      }
    }

    // Contexto Chromium fresco por rep: evita acumulo de memoria/DOM apos campanhas
    // de alta taxa (1ms) que crasham o renderer entre reps. Custo: ~3s por rep.
    const context = await launchContext({ userDataDir, downloadsPath: absoluteResultsDir });
    let page = null;

    try {
      page = await context.newPage();
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.warn(`[webserial-page] ${msg.text()}`);
        }
      });
      page.on('crash', () => {
        console.warn(`[webserial-page] !!! renderer crashed (provavel OOM apos 1ms)`);
      });
      page.on('pageerror', (err) => {
        console.warn(`[webserial-page] !!! pageerror: ${err.message}`);
      });

      await runSingleWebserialRep({
        page, baseUrl, source, rep, reps, durationSeconds, intervalsMs,
        campaignType, absoluteResultsDir, heartbeatIntervalMs,
      });
    } catch (error) {
      console.warn(
        `[orchestrator] rep ${rep} (webserial) falhou: ${error.message}. ${continueOnError ? 'Continuando para a proxima rep.' : 'Abortando.'}`
      );
      if (!continueOnError) {
        await context.close().catch(() => {});
        throw error;
      }
      if (page && !page.isClosed()) {
        try {
          await page.click('#disconnect').catch(() => {});
          await page.click('#simStop').catch(() => {});
        } catch {
          // ignore
        }
      }
    } finally {
      await context.close().catch(() => {});
    }
  }
}

async function runSingleWebserialRep({
  page, baseUrl, source, rep, reps, durationSeconds, intervalsMs,
  campaignType, absoluteResultsDir, heartbeatIntervalMs,
}) {
  await page.goto(baseUrl);
  await page.waitForSelector('#experimentCampaign', { timeout: 10_000 });
  await page.reload();
  await page.waitForSelector('#experimentCampaign', { timeout: 10_000 });

  await setNumberInput(page, '#durationSeconds', durationSeconds);
  await setNumberInput(page, '#replicationNumber', rep);
  await setNumberInput(page, '#intervalMs', intervalsMs[0]);
  await page.evaluate(
    ({ type, intervals }) => {
      window.__PFC_EXPERIMENT_CAMPAIGN = { type, intervalsMs: intervals };
    },
    { type: campaignType, intervals: intervalsMs }
  );

  if (source === 'serial') {
    const portCount = await page.evaluate(async () => {
      if (!navigator.serial) return 0;
      const ports = await navigator.serial.getPorts();
      return ports.length;
    });

    if (portCount === 0) {
      throw new Error(
        "Nenhuma porta serial autorizada no perfil persistente. Rode 'run-experiments.mjs --bootstrap-webserial' uma vez."
      );
    }

    await page.click('#connect');
    await waitForLogContains(page, 'Aberto a', 15_000);
  } else {
    await page.click('#simStart');
    await sleep(500);
  }

  console.log(
    `[orchestrator] Iniciando campanha ${campaignType} (${intervalsMs.length} intervalos x ${durationSeconds}s).`
  );
  await page.click('#experimentCampaign');

  const heartbeat = createHeartbeat({
    label: `webserial-${source}`,
    intervalMs: heartbeatIntervalMs,
    getStatus: async () => {
      try {
        const status = await page.evaluate(() => ({
          total: document.querySelector('#totalMessages')?.textContent ?? '?',
          mps: document.querySelector('#messagesPerSecond')?.textContent ?? '?',
          lost: document.querySelector('#lostMessages')?.textContent ?? '?',
          state: document.querySelector('#experimentStatus')?.textContent ?? '?',
        }));
        return {
          rep: `${rep}/${reps}`,
          total: status.total, mps: status.mps, lost: status.lost,
          state: (status.state || '').slice(0, 60),
        };
      } catch {
        return { rep: `${rep}/${reps}`, state: 'dom_unavailable' };
      }
    },
  });

  heartbeat.start();
  try {
    // A automacao injeta a matriz da campanha antes de clicar em
    // #experimentCampaign, entao o timeout acompanha esses intervalos.
    const effectiveIntervalsCount = intervalsMs.length;
    const campaignTimeoutMs = effectiveIntervalsCount * durationSeconds * 1000 + 120_000;
    await waitForCampaignDone(page, campaignTimeoutMs);
  } finally {
    heartbeat.stop();
  }
  console.log('[orchestrator] Campanha concluida. Solicitando export...');

  const downloadPromise = captureDownloads({
    page, expectedCount: 4,
    resultsDir: absoluteResultsDir,
    timeoutMs: 60_000,
  });

  await page.click('#experimentExport');
  const saved = await downloadPromise;
  console.log(`[orchestrator] ${saved.length} arquivos salvos para rep ${rep}.`);

  if (source === 'serial') {
    await page.click('#disconnect').catch(() => {});
  } else {
    await page.click('#simStop').catch(() => {});
  }
  await sleep(500);
}
