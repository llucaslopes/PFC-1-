#!/usr/bin/env node
/**
 * Campanha de escalabilidade vertical dedicada (TCC/PFC).
 *
 * Wi-Fi (A1+A2+A3). Intervalos progressivos: 1000, 500, 200, 100, 50, 20.
 * Tres arquiteturas, 3 repeticoes de 60 s.
 *
 * Tudo e gravado em `resultados/escalabilidade-2026-06-wifi/` por padrao,
 * sem tocar em resultados antigos (que ficam preservados em
 * `resultados/_legacy_usb_serial/`).
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runBackendCampaign } from "./lib/backend-runner.mjs";
import { startKeepAwake } from "./lib/keep-awake.mjs";
import { initLogFile } from "./lib/runtime-utils.mjs";
import { runServerlessCampaign } from "./lib/serverless-runner.mjs";
import {
  attachServerless,
  startBackend,
  startServerless,
  stop,
} from "./lib/server-control.mjs";

import {
  parseArgs,
  parseIntList as parseIntervals,
  parseList,
  parsePositiveInt,
} from "./lib_mjs/cli-args.mjs";
import { runPython } from "./lib_mjs/python-runner.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CAMPAIGN = {
  type: "scalability",
  name: "escalabilidade-2026-06-wifi",
  intervalsMs: [1000, 500, 200, 100, 50, 20],
  defaultReps: 3,
  defaultDurationSeconds: 60,
};

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Uso: node scripts/run-scalability-campaign.mjs [opcoes]

Campanha de escalabilidade vertical (taxa por cliente unico) sobre Wi-Fi.
Roda A1/A2/A3 com 6 intervalos x 3 reps x 60 s.

Opcoes:
  --source wifi-http|simulator
  --reps 3
  --duration 60
  --intervals 1000,500,200,100,50,20
  --scenarios a1,a2,a3
  --campaign-dir <path>
  --port-backend 3000
  --port-serverless 3001
  --serverless-base-url <url>   se setado, usa esse deployment ao inves de vercel dev local
  --serverless-api-key <key>
  --cold-start-delay-ms 0
  --log-file logs/scalability.log
  --heartbeat-ms 10000
  --no-resume
  --no-continue-on-error
  --no-keep-awake
  --skip-analysis
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (args["log-file"]) initLogFile(resolve(rootDir, args["log-file"]));

  const source = args.source === "simulator" ? "simulator" : "wifi-http";
  const reps = parsePositiveInt(args.reps, CAMPAIGN.defaultReps);
  const durationSeconds = parsePositiveInt(args.duration, CAMPAIGN.defaultDurationSeconds);
  const intervalsMs = parseIntervals(args.intervals, CAMPAIGN.intervalsMs);
  const scenarios = parseList(args.scenarios, ["a1", "a2", "a3"]).map((s) => s.toLowerCase());
  const campaignDir = resolve(
    rootDir,
    args["campaign-dir"] ?? `resultados/${CAMPAIGN.name}`
  );
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

  if (!existsSync(campaignDir)) mkdirSync(campaignDir, { recursive: true });

  console.log("[scalability] ============================================================");
  console.log(`[scalability] Campanha: ${CAMPAIGN.name} (type=${CAMPAIGN.type})`);
  console.log("[scalability] ------------------------------------------------------------");
  console.log(`  source           = ${source}`);
  console.log(`  intervals (ms)   = ${intervalsMs.join(", ")}`);
  console.log(`  scenarios        = ${scenarios.join(", ")}`);
  console.log(`  reps             = ${reps}`);
  console.log(`  duration (s)     = ${durationSeconds}`);
  console.log(`  campaignDir      = ${campaignDir}`);
  console.log(`  serverlessBaseUrl= ${serverlessBaseUrl ?? `(local) http://localhost:${serverlessPort}`}`);
  console.log("[scalability] ============================================================\n");

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    if (scenarios.includes("a1") || scenarios.includes("a2")) {
      let backend;
      try {
        backend = await startBackend({ source, port: backendPort });
        try {
          if (scenarios.includes("a1")) {
            await runBackendCampaign({
              baseUrl: `http://localhost:${backendPort}`,
              mode: "websocket",
              source,
              reps,
              durationSeconds,
              intervalsMs,
              campaignType: CAMPAIGN.type,
              resultsDir: campaignDir,
              resume,
              continueOnError,
              heartbeatIntervalMs,
            });
          }
          if (scenarios.includes("a2")) {
            await runBackendCampaign({
              baseUrl: `http://localhost:${backendPort}`,
              mode: "rest-polling",
              source,
              reps,
              durationSeconds,
              intervalsMs,
              campaignType: CAMPAIGN.type,
              resultsDir: campaignDir,
              resume,
              continueOnError,
              heartbeatIntervalMs,
            });
          }
        } finally {
          await stop(backend);
        }
      } catch (error) {
        console.warn(`[scalability] A1/A2 falhou: ${error.message}.`);
        if (!continueOnError) throw error;
      }
    }

    if (scenarios.includes("a3")) {
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
            intervalsMs,
            campaignType: CAMPAIGN.type,
            resultsDir: campaignDir,
            resume,
            continueOnError,
            heartbeatIntervalMs,
            forceColdStartMs: coldStartDelayMs,
          });
        } finally {
          await stop(serverlessHandle);
        }
      } catch (error) {
        console.warn(`[scalability] A3 falhou: ${error.message}.`);
        if (!continueOnError) throw error;
      }
    }

    if (!skipAnalysis) {
      try {
        await runPython("scalability_metrics.py", [campaignDir]);
        await runPython("plot_scalability.py", [campaignDir]);
      } catch (error) {
        console.warn(
          `[scalability] Pos-processamento opcional falhou (${error.message}). CSV/JSON estao salvos.`
        );
      }
    }

    console.log(`\n[scalability] Concluido. Arquivos em ${campaignDir}.`);
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
