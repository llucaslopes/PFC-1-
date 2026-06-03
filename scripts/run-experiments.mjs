#!/usr/bin/env node
/**
 * Orquestrador principal da campanha A1 + A2 + A3 sobre Wi-Fi.
 *
 * Cenarios:
 *   - A1: backend-node WebSocket   (modo "websocket")
 *   - A2: backend-node REST polling (modo "rest-polling")
 *   - A3: serverless (Vercel Functions, modo "serverless-http")
 *
 * Fonte oficial: ESP32 real conectado por Wi-Fi (`source=wifi-http`).
 * Sanity-check sem hardware: `--source simulator` -- nao vale como dado
 * oficial do TCC.
 *
 * WebSerial e fonte serial USB foram removidos do caminho oficial e ficam
 * preservados em pastas `_legacy_*` apenas para reproduzir campanhas
 * antigas.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBackendCampaign } from "./lib/backend-runner.mjs";
import { startKeepAwake } from "./lib/keep-awake.mjs";
import { initLogFile } from "./lib/runtime-utils.mjs";
import { runServerlessCampaign } from "./lib/serverless-runner.mjs";
import { attachServerless, startBackend, startServerless, stop } from "./lib/server-control.mjs";

import {
  parseArgs,
  parseIntList as parseIntervals,
  parseList,
  parsePositiveInt,
} from "./lib_mjs/cli-args.mjs";
import { runPython } from "./lib_mjs/python-runner.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAMPAIGNS = {
  official: {
    type: "official",
    description: "campanha oficial Wi-Fi (A1+A2+A3)",
    defaultIntervalsMs: [1000, 500, 200, 100, 50, 20],
    scenarioIntervalsMs: {
      a1: [1000, 500, 200, 100, 50, 20],
      a2: [1000, 500, 200, 100, 50, 20],
      a3: [1000, 500, 200, 100, 50, 20],
    },
  },
  refinement: {
    type: "saturation-refinement",
    description: "campanha complementar de refinamento (intervalos extremos)",
    defaultIntervalsMs: [10, 5, 2000, 5000],
    scenarioIntervalsMs: {
      a1: [10, 5],
      a2: [2000, 5000],
      a3: [10, 5, 2000, 5000],
    },
  },
  coldstart: {
    type: "cold-start",
    description: "campanha de cold start (apenas A3)",
    defaultIntervalsMs: [100],
    scenarioIntervalsMs: {
      a1: [],
      a2: [],
      a3: [100],
    },
  },
};

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Uso: node scripts/run-experiments.mjs [opcoes]

Opcoes:
  --source wifi-http|simulator  fonte (default: wifi-http; simulator=sanity-check sem hardware)
  --campaign official|refinement|coldstart
                                official    = matriz oficial 1000..20 ms (default)
                                refinement  = intervalos extremos (10/5/2000/5000)
                                coldstart   = campanha dedicada A3 com warmup forcado
  --reps 3                      repeticoes
  --duration 60                 segundos por intervalo
  --intervals 1000,500,200,100,50,20  override manual da matriz
  --scenarios a1,a2,a3          quais cenarios executar (subset)
  --serverless-base-url <url>   URL do deployment Vercel (se omitido, sobe vercel dev local em :3001)
  --serverless-api-key <key>    valor de X-Api-Key (default: env INGEST_API_KEY)
  --cold-start-delay-ms 0       espera antes de cada intervalo A3 (forca cold start)
  --results-dir resultados      diretorio dos CSV/JSON
  --port-backend 3000           porta do backend (A1/A2)
  --port-serverless 3001        porta local do vercel dev (apenas se sem --serverless-base-url)
  --log-file logs/run.log       tee de stdout/stderr
  --heartbeat-ms 10000
  --no-resume                   nao pula reps cujos arquivos ja existem
  --no-continue-on-error        aborta tudo na primeira falha
  --no-keep-awake               nao impede sleep do Windows
  --skip-analysis               nao roda consolidate_results.py + plot_results.py
  --help

Exemplos:
  node scripts/run-experiments.mjs                                  # campanha oficial Wi-Fi
  node scripts/run-experiments.mjs --scenarios a1,a2 --reps 5       # so backend
  node scripts/run-experiments.mjs --scenarios a3 --reps 3 \\
      --serverless-base-url https://meu-projeto.vercel.app
  node scripts/run-experiments.mjs --campaign coldstart --scenarios a3
`);
}

function resolveCampaign(args) {
  const requested = String(args.campaign ?? "official").toLowerCase();
  if (requested === "refinement" || requested === "saturation-refinement") return CAMPAIGNS.refinement;
  if (requested === "coldstart" || requested === "cold-start") return CAMPAIGNS.coldstart;
  return CAMPAIGNS.official;
}

function resolveScenarioIntervals({ args, campaign, scenario }) {
  if (args.intervals !== undefined) {
    return parseIntervals(args.intervals, campaign.defaultIntervalsMs);
  }
  return [...(campaign.scenarioIntervalsMs[scenario] ?? campaign.defaultIntervalsMs)];
}

function normalizeSource(args) {
  return args.source === "simulator" ? "simulator" : "wifi-http";
}

async function runCampaignForSource({
  source, scenarios, reps, durationSeconds, campaign,
  scenarioIntervalsMs, resultsDir, backendPort, serverlessPort,
  serverlessBaseUrl, serverlessApiKey, coldStartDelayMs, resume,
  continueOnError, heartbeatIntervalMs,
}) {
  console.log(`\n[orchestrator] ##### Fonte: ${source} #####`);
  if (source === "wifi-http") {
    console.log(
      "[orchestrator] Verifique se o ESP32 esta ligado, conectado ao Wi-Fi e apontando para o endpoint do cenario atual."
    );
  }

  const wantsA1 = scenarios.includes("a1");
  const wantsA2 = scenarios.includes("a2");
  const wantsA3 = scenarios.includes("a3");

  if (wantsA1 || wantsA2) {
    console.log(`\n[orchestrator] ===== Cenarios backend-node (A1/A2) / source=${source} =====`);
    let backend;
    try {
      backend = await startBackend({
        source,
        port: backendPort,
      });
      try {
        if (wantsA1 && scenarioIntervalsMs.a1.length > 0) {
          console.log(`\n[orchestrator] --- A1 (WebSocket) / source=${source} ---`);
          await runBackendCampaign({
            baseUrl: `http://localhost:${backendPort}`,
            mode: "websocket",
            source,
            reps,
            durationSeconds,
            intervalsMs: scenarioIntervalsMs.a1,
            campaignType: campaign.type,
            resultsDir,
            resume,
            continueOnError,
            heartbeatIntervalMs,
          });
        }
        if (wantsA2 && scenarioIntervalsMs.a2.length > 0) {
          console.log(`\n[orchestrator] --- A2 (REST polling) / source=${source} ---`);
          await runBackendCampaign({
            baseUrl: `http://localhost:${backendPort}`,
            mode: "rest-polling",
            source,
            reps,
            durationSeconds,
            intervalsMs: scenarioIntervalsMs.a2,
            campaignType: campaign.type,
            resultsDir,
            resume,
            continueOnError,
            heartbeatIntervalMs,
          });
        }
      } finally {
        await stop(backend);
      }
    } catch (error) {
      console.warn(
        `[orchestrator] Backend (${source}) falhou globalmente: ${error.message}. ${continueOnError ? "Seguindo." : ""}`
      );
      if (!continueOnError) throw error;
    }
  }

  if (wantsA3 && scenarioIntervalsMs.a3.length > 0) {
    console.log(`\n[orchestrator] ===== Cenario A3 (serverless) / source=${source} =====`);
    let serverlessHandle;
    try {
      let resolvedBaseUrl;
      if (serverlessBaseUrl) {
        serverlessHandle = await attachServerless({ baseUrl: serverlessBaseUrl });
        resolvedBaseUrl = serverlessHandle.baseUrl;
      } else {
        serverlessHandle = await startServerless({ port: serverlessPort });
        resolvedBaseUrl = `http://localhost:${serverlessPort}`;
      }
      try {
        await runServerlessCampaign({
          baseUrl: resolvedBaseUrl,
          apiKey: serverlessApiKey,
          source,
          reps,
          durationSeconds,
          intervalsMs: scenarioIntervalsMs.a3,
          campaignType: campaign.type,
          resultsDir,
          resume,
          continueOnError,
          heartbeatIntervalMs,
          forceColdStartMs: coldStartDelayMs,
        });
      } finally {
        await stop(serverlessHandle);
      }
    } catch (error) {
      console.warn(
        `[orchestrator] Serverless (${source}) falhou globalmente: ${error.message}. ${continueOnError ? "Seguindo." : ""}`
      );
      if (!continueOnError) throw error;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (args["log-file"]) initLogFile(resolve(rootDir, args["log-file"]));

  const sources = [normalizeSource(args)];
  const campaign = resolveCampaign(args);
  const reps = parsePositiveInt(args.reps, 3);
  const durationSeconds = parsePositiveInt(args.duration, 60);
  const scenarios = parseList(args.scenarios, ["a1", "a2", "a3"]).map((s) => s.toLowerCase());
  const scenarioIntervalsMs = {
    a1: resolveScenarioIntervals({ args, campaign, scenario: "a1" }),
    a2: resolveScenarioIntervals({ args, campaign, scenario: "a2" }),
    a3: resolveScenarioIntervals({ args, campaign, scenario: "a3" }),
  };
  const resultsDir = resolve(rootDir, args["results-dir"] ?? "resultados");
  const backendPort = parsePositiveInt(args["port-backend"], 3000);
  const serverlessPort = parsePositiveInt(args["port-serverless"], 3001);
  const serverlessBaseUrl = args["serverless-base-url"] ?? process.env.SERVERLESS_BASE_URL ?? null;
  const serverlessApiKey = args["serverless-api-key"] ?? process.env.INGEST_API_KEY ?? "";
  const coldStartDelayMs = parseNonNegativeInt(args["cold-start-delay-ms"], 0);
  const skipAnalysis = Boolean(args["skip-analysis"]);
  const resume = !args["no-resume"];
  const continueOnError = !args["no-continue-on-error"];
  const keepAwakeEnabled = !args["no-keep-awake"];
  const heartbeatIntervalMs = parseNonNegativeInt(args["heartbeat-ms"], 10_000);

  console.log(`[orchestrator] Configuracao:`);
  console.log(`  source             = ${sources.join(", ")}`);
  console.log(`  campaign           = ${campaign.type} (${campaign.description})`);
  console.log(`  reps               = ${reps}`);
  console.log(`  duration           = ${durationSeconds}s`);
  console.log(`  scenarios          = ${scenarios.join(", ")}`);
  console.log(`  intervals[a1]      = ${scenarioIntervalsMs.a1.join(", ")} ms`);
  console.log(`  intervals[a2]      = ${scenarioIntervalsMs.a2.join(", ")} ms`);
  console.log(`  intervals[a3]      = ${scenarioIntervalsMs.a3.join(", ")} ms`);
  console.log(`  resultsDir         = ${resultsDir}`);
  console.log(`  backendPort        = ${backendPort}`);
  console.log(`  serverlessBaseUrl  = ${serverlessBaseUrl ?? `(local) http://localhost:${serverlessPort}`}`);
  console.log(`  coldStartDelayMs   = ${coldStartDelayMs}`);
  console.log(`  resume             = ${resume}`);
  console.log(`  continueOnError    = ${continueOnError}`);
  console.log(`  keepAwake          = ${keepAwakeEnabled}`);

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    for (const source of sources) {
      try {
        await runCampaignForSource({
          source,
          scenarios,
          reps,
          durationSeconds,
          campaign,
          scenarioIntervalsMs,
          resultsDir,
          backendPort,
          serverlessPort,
          serverlessBaseUrl,
          serverlessApiKey,
          coldStartDelayMs,
          resume,
          continueOnError,
          heartbeatIntervalMs,
        });
      } catch (error) {
        console.warn(
          `[orchestrator] Fonte '${source}' falhou globalmente: ${error.message}. ${continueOnError ? "Seguindo." : "Abortando."}`
        );
        if (!continueOnError) throw error;
      }
    }

    if (!skipAnalysis) {
      console.log(`\n[orchestrator] ===== Consolidando resultados =====`);
      try {
        await runPython("consolidate_results.py", [resultsDir]);
        await runPython("plot_results.py", [resultsDir]);
      } catch (error) {
        console.warn(
          `[orchestrator] Analise opcional falhou (${error.message}). Resultados brutos ja foram salvos.`
        );
      }
    } else {
      console.log("[orchestrator] --skip-analysis: pulei consolidate/plot.");
    }

    console.log(`\n[orchestrator] Concluido. CSV/JSON em ${resultsDir}.`);
  } finally {
    keepAwake.stop();
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[orchestrator] ERRO: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
