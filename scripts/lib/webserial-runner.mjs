import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHeartbeat, isRepComplete } from "./runtime-utils.mjs";

const SERIAL_PERMISSION_POLL_MS = 1000;
const SERIAL_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      "Playwright nao esta instalado. Rode 'npm install' e 'npx playwright install chromium' antes."
    );
  }
}

async function launchContext({ userDataDir, headless = false, downloadsPath }) {
  const { chromium } = await loadPlaywright();
  await fs.mkdir(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    acceptDownloads: true,
    downloadsPath,
    args: [
      "--enable-blink-features=Serial",
      "--no-default-browser-check",
      "--no-first-run"
    ]
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

export async function bootstrapSerialPermission({
  baseUrl = "http://localhost:8765/",
  userDataDir
}) {
  console.log("[orchestrator] Bootstrap WebSerial: abrindo Chrome para autorizar a porta serial.");
  console.log("[orchestrator] => Clique em 'Conectar serial' e selecione a porta COMx do Arduino.");
  console.log("[orchestrator]    O script fecha o navegador sozinho assim que detectar permissao.");

  const context = await launchContext({ userDataDir });
  try {
    return await waitForSerialPermissionOnContext({ context, baseUrl });
  } finally {
    await context.close();
  }
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

  console.log("[orchestrator] Permissao salva no perfil persistente.");
  return true;
}

/**
 * Retorna true se o perfil persistente ja tem uma porta serial autorizada.
 * Cria um Chromium efemero so para checar; o usuario nao ve nada (headless).
 */
export async function hasSerialPermission({ baseUrl = "http://localhost:8765/", userDataDir }) {
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

async function setNumberInput(page, selector, value) {
  await page.evaluate(
    ({ sel, val }) => {
      const input = document.querySelector(sel);
      if (!input) return;
      input.value = String(val);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, val: value }
  );
}

async function waitForLogContains(page, text, timeoutMs) {
  await page.waitForFunction(
    (expected) => {
      const log = document.querySelector("#log");
      return log && log.textContent.includes(expected);
    },
    text,
    { timeout: timeoutMs }
  );
}

async function waitForCampaignDone(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const status = document.querySelector("#experimentStatus");
      return status && status.textContent.includes("Campanha concluida");
    },
    null,
    { timeout: timeoutMs }
  );
}

async function captureDownloads({ page, expectedCount, resultsDir, timeoutMs }) {
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

  page.on("download", handler);

  const startedAt = Date.now();
  while (downloadPromises.length < expectedCount && Date.now() - startedAt < timeoutMs) {
    await sleep(250);
  }

  await Promise.all(downloadPromises);
  page.off("download", handler);
  return saved;
}

export async function runWebserialCampaign({
  baseUrl = "http://localhost:8765/",
  source = "serial",
  reps = 3,
  durationSeconds = 60,
  intervalsMs = [100, 50, 20, 10, 5, 1],
  campaignType = "official",
  resultsDir = "resultados",
  userDataDir,
  resume = true,
  continueOnError = true,
  heartbeatIntervalMs = 10_000
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
        architecture: "webserial",
        communicationMode: "webserial",
        source,
        lastIntervalMs,
        rep,
        campaignType
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
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.warn(`[webserial-page] ${msg.text()}`);
        }
      });
      page.on("crash", () => {
        console.warn(`[webserial-page] !!! renderer crashed (provavel OOM apos 1ms)`);
      });
      page.on("pageerror", (err) => {
        console.warn(`[webserial-page] !!! pageerror: ${err.message}`);
      });

      await runSingleWebserialRep({
        page,
        baseUrl,
        source,
        rep,
        reps,
        durationSeconds,
        intervalsMs,
        campaignType,
        absoluteResultsDir,
        heartbeatIntervalMs
      });
    } catch (error) {
      console.warn(
        `[orchestrator] rep ${rep} (webserial) falhou: ${error.message}. ${continueOnError ? "Continuando para a proxima rep." : "Abortando."}`
      );
      if (!continueOnError) {
        await context.close().catch(() => {});
        throw error;
      }
      if (page && !page.isClosed()) {
        try {
          await page.click("#disconnect").catch(() => {});
          await page.click("#simStop").catch(() => {});
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
  page,
  baseUrl,
  source,
  rep,
  reps,
  durationSeconds,
  intervalsMs,
  campaignType,
  absoluteResultsDir,
  heartbeatIntervalMs
}) {
  await page.goto(baseUrl);
  await page.waitForSelector("#experimentCampaign", { timeout: 10_000 });
  await page.reload();
  await page.waitForSelector("#experimentCampaign", { timeout: 10_000 });

  await setNumberInput(page, "#durationSeconds", durationSeconds);
  await setNumberInput(page, "#replicationNumber", rep);
  await setNumberInput(page, "#intervalMs", intervalsMs[0]);
  await page.evaluate(
    ({ type, intervals }) => {
      window.__PFC_EXPERIMENT_CAMPAIGN = {
        type,
        intervalsMs: intervals
      };
    },
    { type: campaignType, intervals: intervalsMs }
  );

  if (source === "serial") {
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

    await page.click("#connect");
    await waitForLogContains(page, "Aberto a", 15_000);
  } else {
    await page.click("#simStart");
    await sleep(500);
  }

  console.log(
    `[orchestrator] Iniciando campanha ${campaignType} (${intervalsMs.length} intervalos x ${durationSeconds}s).`
  );
  await page.click("#experimentCampaign");

  const heartbeat = createHeartbeat({
    label: `webserial-${source}`,
    intervalMs: heartbeatIntervalMs,
    getStatus: async () => {
      try {
        const status = await page.evaluate(() => ({
          total: document.querySelector("#totalMessages")?.textContent ?? "?",
          mps: document.querySelector("#messagesPerSecond")?.textContent ?? "?",
          lost: document.querySelector("#lostMessages")?.textContent ?? "?",
          state: document.querySelector("#experimentStatus")?.textContent ?? "?"
        }));
        return {
          rep: `${rep}/${reps}`,
          total: status.total,
          mps: status.mps,
          lost: status.lost,
          state: (status.state || "").slice(0, 60)
        };
      } catch {
        return { rep: `${rep}/${reps}`, state: "dom_unavailable" };
      }
    }
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
  console.log("[orchestrator] Campanha concluida. Solicitando export...");

  const downloadPromise = captureDownloads({
    page,
    expectedCount: 4,
    resultsDir: absoluteResultsDir,
    timeoutMs: 60_000
  });

  await page.click("#experimentExport");
  const saved = await downloadPromise;
  console.log(`[orchestrator] ${saved.length} arquivos salvos para rep ${rep}.`);

  if (source === "serial") {
    await page.click("#disconnect").catch(() => {});
  } else {
    await page.click("#simStop").catch(() => {});
  }
  await sleep(500);
}
