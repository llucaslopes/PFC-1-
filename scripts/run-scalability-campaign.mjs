#!/usr/bin/env node
/**
 * Campanha de escalabilidade dedicada (TCC/PFC).
 *
 * - Intervalos progressivos: 100, 50, 20, 10, 5, 4, 3, 2, 1 ms.
 * - 3 repeticoes de 60 s por arquitetura (C1 webserial, C2 websocket, C3 rest-polling).
 * - Todos os arquivos sao gravados APENAS em `resultados/escalabilidade-2026-05/`.
 *   Nada fora dessa pasta e tocado (resultados antigos permanecem intactos).
 *
 * Reusa os runners existentes em `scripts/lib/` (sem modifica-los), apenas
 * passando `campaignType = "scalability"` e o resultsDir dedicado.
 *
 * Apos a coleta, invoca o pos-processamento Python:
 *   scripts/scalability_metrics.py  -> per-run summary + consolidated_metrics.{csv,json}
 *   scripts/plot_scalability.py     -> 4 PNGs em <campaignDir>/plots/
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runBackendCampaign } from "./lib/backend-runner.mjs";
import { startKeepAwake } from "./lib/keep-awake.mjs";
import { initLogFile } from "./lib/runtime-utils.mjs";
import { resolveSerialPort } from "./lib/serial-detect.mjs";
import { startBackend, startWebserial, stop } from "./lib/server-control.mjs";
import {
  bootstrapSerialPermission,
  hasSerialPermission,
  runWebserialCampaign
} from "./lib/webserial-runner.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CAMPAIGN = {
  type: "scalability",
  name: "escalabilidade-2026-05",
  intervalsMs: [100, 50, 20, 10, 5, 4, 3, 2, 1],
  defaultReps: 3,
  defaultDurationSeconds: 60
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

function parseList(value, fallback) {
  if (value === undefined || value === true) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntervals(value, fallback) {
  const parts = parseList(value, fallback.map(String));
  return parts
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part) && part > 0);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Uso: node scripts/run-scalability-campaign.mjs [opcoes]

Executa a campanha de escalabilidade (campaignType="scalability") nas tres
arquiteturas, com 9 intervalos x 3 repeticoes x 60s cada, gravando TUDO em
resultados/escalabilidade-2026-05/ (sem tocar nos resultados antigos).

Opcoes:
  --source serial|simulator     fonte das amostras (default: serial)
  --serial-port COM3|auto       porta do Arduino (default: auto)
  --reps 3                      repeticoes por intervalo (default: 3)
  --duration 60                 segundos por intervalo (default: 60)
  --intervals 100,50,20,10,5,4,3,2,1
                                sobrescreve a matriz padrao (use com cautela)
  --scenarios c1,c2,c3          quais arquiteturas executar (default: todas)
  --campaign-dir <path>         override do destino dos arquivos
                                (default: resultados/escalabilidade-2026-05)
  --port-backend 3000           porta do backend Node.js
  --port-webserial 8765         porta do servidor estatico do prototipo C1
  --chromium-user-data <path>   perfil persistente do Playwright/Chromium
  --log-file logs/scalability.log
                                tee de stdout/stderr para arquivo
  --heartbeat-ms 10000          intervalo do heartbeat (0 desliga)
  --no-resume                   refaz reps cujos arquivos ja existem
  --no-continue-on-error        aborta tudo na primeira falha
  --no-keep-awake               nao impede o Windows de dormir durante o run
  --no-auto-bootstrap           nao tenta autorizar a porta serial automaticamente
  --skip-analysis               nao roda scalability_metrics.py + plot_scalability.py
  --bootstrap-webserial         so abre o Chrome para autorizar a porta serial e sai
  --help

Exemplos:
  npm run experiment:scalability
  node scripts/run-scalability-campaign.mjs --serial-port COM3
  node scripts/run-scalability-campaign.mjs --scenarios c2,c3 --reps 3
  node scripts/run-scalability-campaign.mjs --source simulator     # sanity check
  node scripts/run-scalability-campaign.mjs --skip-analysis        # so coleta
`);
}

function runPython(scriptName, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const child = spawn(pythonCmd, [resolve(rootDir, "scripts", scriptName), ...args], {
      stdio: "inherit",
      shell: false
    });
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${scriptName} saiu com codigo ${code}`));
    });
    child.on("error", rejectRun);
  });
}

async function runForScenario({
  scenario,
  source,
  reps,
  durationSeconds,
  intervalsMs,
  campaignDir,
  backendPort,
  webserialPort,
  userDataDir,
  resume,
  continueOnError,
  heartbeatIntervalMs,
  autoBootstrap,
  resolvedSerialPort
}) {
  if (scenario === "c1") {
    console.log(`\n[scalability] ===== C1 (WebSerial) / source=${source} =====`);
    const webserial = await startWebserial({ port: webserialPort });
    try {
      const baseUrl = `http://localhost:${webserialPort}/`;
      if (source === "serial" && autoBootstrap) {
        const granted = await hasSerialPermission({ baseUrl, userDataDir });
        if (!granted) {
          console.log("[scalability] WebSerial sem permissao salva; abrindo bootstrap automatico.");
          await bootstrapSerialPermission({ baseUrl, userDataDir });
        }
      }
      await runWebserialCampaign({
        baseUrl,
        source,
        reps,
        durationSeconds,
        intervalsMs,
        campaignType: CAMPAIGN.type,
        resultsDir: campaignDir,
        userDataDir,
        resume,
        continueOnError,
        heartbeatIntervalMs
      });
    } finally {
      await stop(webserial);
    }
    return;
  }

  const mode = scenario === "c2" ? "websocket" : "rest-polling";
  console.log(`\n[scalability] ===== ${scenario.toUpperCase()} (${mode}) / source=${source} =====`);
  const backend = await startBackend({
    source,
    serialPort: resolvedSerialPort,
    port: backendPort
  });
  try {
    await runBackendCampaign({
      baseUrl: `http://localhost:${backendPort}`,
      mode,
      source,
      reps,
      durationSeconds,
      intervalsMs,
      campaignType: CAMPAIGN.type,
      resultsDir: campaignDir,
      resume,
      continueOnError,
      heartbeatIntervalMs
    });
  } finally {
    await stop(backend);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args["log-file"]) {
    initLogFile(resolve(rootDir, args["log-file"]));
  }

  const source = args.source === "simulator" ? "simulator" : "serial";
  const serialPortConfigured = args["serial-port"] ?? process.env.SERIAL_PORT ?? "auto";
  const reps = parsePositiveInt(args.reps, CAMPAIGN.defaultReps);
  const durationSeconds = parsePositiveInt(args.duration, CAMPAIGN.defaultDurationSeconds);
  const intervalsMs = parseIntervals(args.intervals, CAMPAIGN.intervalsMs);
  const scenarios = parseList(args.scenarios, ["c1", "c2", "c3"]).map((s) => s.toLowerCase());
  const campaignDir = resolve(
    rootDir,
    args["campaign-dir"] ?? `resultados/${CAMPAIGN.name}`
  );
  const backendPort = parsePositiveInt(args["port-backend"], 3000);
  const webserialPort = parsePositiveInt(args["port-webserial"], 8765);
  const userDataDir = resolve(rootDir, args["chromium-user-data"] ?? ".playwright-profile");
  const skipAnalysis = Boolean(args["skip-analysis"]);
  const resume = !args["no-resume"];
  const continueOnError = !args["no-continue-on-error"];
  const keepAwakeEnabled = !args["no-keep-awake"];
  const autoBootstrap = !args["no-auto-bootstrap"];
  const heartbeatIntervalMs = parseNonNegativeInt(args["heartbeat-ms"], 10_000);

  if (!existsSync(campaignDir)) {
    mkdirSync(campaignDir, { recursive: true });
  }

  if (args["bootstrap-webserial"]) {
    const webserial = await startWebserial({ port: webserialPort });
    try {
      await bootstrapSerialPermission({
        baseUrl: `http://localhost:${webserialPort}/`,
        userDataDir
      });
    } finally {
      await stop(webserial);
    }
    return;
  }

  const resolvedSerialPort =
    source === "serial" ? await resolveSerialPort(serialPortConfigured) : null;
  if (source === "serial" && !resolvedSerialPort) {
    console.warn(
      `[scalability] Fonte serial sem porta COM detectada. Conecte o Arduino ou use --source simulator.`
    );
    return;
  }

  const totalRuns = scenarios.length * intervalsMs.length * reps;
  const totalSeconds = totalRuns * durationSeconds;
  const estimatedMinutes = Math.ceil(totalSeconds / 60);

  console.log("[scalability] ============================================================");
  console.log(`[scalability] Campanha: ${CAMPAIGN.type} (${CAMPAIGN.name})`);
  console.log(`[scalability] ------------------------------------------------------------`);
  console.log(`  source              = ${source}${source === "serial" ? ` (${resolvedSerialPort})` : ""}`);
  console.log(`  scenarios           = ${scenarios.join(", ")}`);
  console.log(`  intervals (ms)      = ${intervalsMs.join(", ")}`);
  console.log(`  reps                = ${reps}`);
  console.log(`  duration (s/rep)    = ${durationSeconds}`);
  console.log(`  total execucoes     = ${totalRuns}`);
  console.log(`  duracao estimada    = ~${estimatedMinutes} min (so de coleta)`);
  console.log(`  campaignDir         = ${campaignDir}`);
  console.log(`  resume              = ${resume}`);
  console.log(`  continueOnError     = ${continueOnError}`);
  console.log(`  keepAwake           = ${keepAwakeEnabled}`);
  console.log(`  autoBootstrap       = ${autoBootstrap}`);
  console.log(`  skipAnalysis        = ${skipAnalysis}`);
  console.log("[scalability] ============================================================\n");

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    for (const scenario of scenarios) {
      try {
        await runForScenario({
          scenario,
          source,
          reps,
          durationSeconds,
          intervalsMs,
          campaignDir,
          backendPort,
          webserialPort,
          userDataDir,
          resume,
          continueOnError,
          heartbeatIntervalMs,
          autoBootstrap,
          resolvedSerialPort
        });
      } catch (error) {
        console.warn(
          `[scalability] Cenario '${scenario}' falhou: ${error.message}. ${continueOnError ? "Seguindo para o proximo." : "Abortando."}`
        );
        if (!continueOnError) throw error;
      }
    }

    if (!skipAnalysis) {
      console.log(`\n[scalability] ===== Pos-processamento =====`);
      try {
        await runPython("scalability_metrics.py", [campaignDir]);
        await runPython("plot_scalability.py", [campaignDir]);
      } catch (error) {
        console.warn(
          `[scalability] Pos-processamento opcional falhou (${error.message}). Os arquivos brutos ja foram salvos.`
        );
      }
    } else {
      console.log("[scalability] --skip-analysis: pulei scalability_metrics + plot_scalability.");
    }

    console.log(`\n[scalability] Concluido. CSV/JSON/PNG em ${campaignDir}.`);
  } finally {
    keepAwake.stop();
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[scalability] ERRO: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
