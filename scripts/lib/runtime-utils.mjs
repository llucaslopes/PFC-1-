import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Inicia "tee" de stdout/stderr para um arquivo de log.
 * Retorna o stream para o caller poder fechar no fim.
 */
export function initLogFile(filePath) {
  if (!filePath) return null;

  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const stream = fs.createWriteStream(absolutePath, { flags: "a" });

  const banner = `\n===== run-experiments inicio ${new Date().toISOString()} =====\n`;
  stream.write(banner);

  for (const channel of ["stdout", "stderr"]) {
    const original = process[channel].write.bind(process[channel]);
    process[channel].write = (chunk, encoding, callback) => {
      try {
        if (typeof chunk === "string") {
          stream.write(chunk);
        } else if (chunk) {
          stream.write(chunk);
        }
      } catch {
        // never let log file kill the run
      }
      return original(chunk, encoding, callback);
    };
  }

  return stream;
}

/**
 * Verifica se uma repeticao ja foi completada, procurando pelo
 * `experiment-summary.json` (ultimo arquivo gravado em writeCampaignFiles).
 */
export async function isRepComplete({
  resultsDir,
  architecture,
  communicationMode,
  source,
  lastIntervalMs,
  rep,
  campaignType = "official"
}) {
  let entries;
  try {
    entries = await fsp.readdir(resultsDir);
  } catch {
    return false;
  }

  const prefix = `${architecture}_${communicationMode}_${source}_${lastIntervalMs}ms_rep${rep}_`;
  const suffix = "_experiment-summary.json";
  const campaignToken = sanitizeFilenamePart(campaignType);
  return entries.some(
    (name) =>
      name.startsWith(prefix) &&
      name.endsWith(suffix) &&
      (campaignType === "official"
        ? !name.includes("_saturation-refinement_")
        : name.includes(`_${campaignToken}${suffix}`))
  );
}

/**
 * Cria um heartbeat periodico que loga a cada N ms enquanto a observacao roda.
 * `getStatus()` deve retornar um objeto livre que sera incluido na linha.
 */
export function createHeartbeat({ label, intervalMs = 10_000, getStatus }) {
  if (intervalMs <= 0) {
    return {
      start() {},
      stop() {}
    };
  }

  let timer = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const result = getStatus?.();
      const status = result && typeof result.then === "function" ? await result : (result ?? {});
      const parts = Object.entries(status)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ");
      console.log(`[heartbeat ${new Date().toISOString()}] ${label} ${parts}`);
    } catch (error) {
      console.warn(`[heartbeat] erro: ${error.message}`);
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  };
}

function sanitizeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9-]+/g, "-");
}
