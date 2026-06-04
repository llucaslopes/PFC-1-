#!/usr/bin/env node
// Orquestrador da campanha experimental do PFC-1. Cobre as quatro
// arquiteturas (A1 WebSocket, A2 REST polling, A3 serverless, A4 MQTT)
// e tres fontes possiveis: ESP32 real via Wi-Fi (oficial do TCC),
// simulador local invocado em-processo pelo backend (legado, mantido
// para sanity check) ou simulador local rodando como subprocesso
// HTTP/MQTT (modo "simulator-http", reproduz a interface do firmware
// para CI). Apenas a fonte wifi-http vale como dado oficial.
//
// As pastas prototypes/_legacy_webserial e embedded/_legacy_arduino_uno
// preservam o material da versao anterior do projeto (WebSerial + USB);
// a reorientacao do trabalho moveu o foco para Wi-Fi e dispensou esses
// caminhos do fluxo oficial.
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runBackendCampaign } from "./lib/backend-runner.mjs";
import {
  startEsp32Simulator,
  stopEsp32Simulator,
} from "./lib/esp32-sim-control.mjs";
import { startKeepAwake } from "./lib/keep-awake.mjs";
import {
  startMqttBridge,
  startMqttBroker,
  stopMqttBridge,
  stopMqttBroker,
} from "./lib/mqtt-control.mjs";
import { runMqttCampaign } from "./lib/mqtt-runner.mjs";
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
    description: "campanha oficial Wi-Fi (A1+A2+A3+A4)",
    defaultIntervalsMs: [1000, 500, 200, 100, 50, 20],
    scenarioIntervalsMs: {
      a1: [1000, 500, 200, 100, 50, 20],
      a2: [1000, 500, 200, 100, 50, 20],
      a3: [1000, 500, 200, 100, 50, 20],
      a4: [1000, 500, 200, 100, 50, 20],
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
      a4: [10, 5, 2000, 5000],
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
      a4: [],
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
  --source wifi-http|simulator|simulator-http
                                fonte (default: wifi-http)
                                  wifi-http       -> ESP32 real (oficial)
                                  simulator       -> simulador in-process do backend (legado, sanity-check sem hardware)
                                  simulator-http  -> sobe scripts/esp32-simulator.mjs como subprocesso a cada intervalo
                                                     (gerador de carga HTTP/MQTT identico ao firmware; campanha PRELIMINAR)
  --campaign official|refinement|coldstart
                                official    = matriz oficial 1000..20 ms (default)
                                refinement  = intervalos extremos (10/5/2000/5000)
                                coldstart   = campanha dedicada A3 com warmup forcado
  --reps 3                      repeticoes
  --duration 60                 segundos por intervalo
  --intervals 1000,500,200,100,50,20  override manual da matriz
  --scenarios a1,a2,a3,a4       quais cenarios executar (default: a1,a2,a3)
                                  a1 -> backend Node + WebSocket
                                  a2 -> backend Node + REST polling
                                  a3 -> serverless (Vercel Functions + KV)
                                  a4 -> MQTT (Mosquitto local + bridge -> WS)
  --serverless-base-url <url>   URL do deployment Vercel (se omitido, sobe vercel dev local em :3001)
  --serverless-api-key <key>    valor de X-Api-Key (default: env INGEST_API_KEY)
  --cold-start-delay-ms 0       espera antes de cada intervalo A3 (forca cold start)
  --results-dir resultados      diretorio dos CSV/JSON
  --port-backend 3000           porta do backend (A1/A2)
  --port-serverless 3001        porta local do vercel dev (apenas se sem --serverless-base-url)
  --port-mqtt-bridge 4002       porta HTTP/WS da bridge MQTT (apenas A4)
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

const VALID_SOURCES = new Set(["wifi-http", "simulator", "simulator-http"]);

function normalizeSource(args) {
  const requested = String(args.source ?? "").toLowerCase();
  if (VALID_SOURCES.has(requested)) return requested;
  return "wifi-http";
}

// No modo simulator-http o servidor (backend ou serverless) opera
// exatamente como em wifi-http -- recebe POSTs externos. A diferenca
// fica na geracao de carga: em vez do ESP32 real, o orquestrador
// spawna esp32-simulator.mjs por intervalo. Os arquivos de saida ainda
// carregam source=simulator-http para que a consolidacao nao misture
// com dados oficiais.
function backendSourceFor(orchestratorSource) {
  return orchestratorSource === "simulator-http" ? "wifi-http" : orchestratorSource;
}

function usesEsp32Simulator(orchestratorSource) {
  return orchestratorSource === "simulator-http";
}

// Em vez de manter um simulador rodando o tempo todo da rep, sobe-se
// e derruba-se um por intervalo. Isso garante que cada intervalo
// comece com simulador zerado (sem residuo de fila/conexao da rajada
// anterior) e permite trocar de transporte entre intervalos sem
// reciclar todo o orquestrador. Espelha o que o ESP32 real faz na
// transicao entre cenarios.
function makeEsp32SimulatorLifecycle({
  scenario,
  deviceId = "esp32-01",
  apiKey = "",
  brokerUrl = "mqtt://localhost:1883",
}) {
  return {
    async beforeObserve({ intervalMs, durationSeconds, baseUrl }) {
      // 2 s a mais de envio do que de coleta: protege contra a fronteira
      // exata da observacao -- se o simulador parar antes, a ultima
      // amostra "valida" pode acabar caindo fora da janela e ser
      // contabilizada como perda em vez de fim natural.
      const durationSec = Math.max(durationSeconds + 2, durationSeconds);
      // A4 ignora baseUrl HTTP: o simulador conecta direto ao broker
      // MQTT e a bridge so eh consumida pelo observeWebSocket no lado
      // de coleta. Manter um baseUrl ali confundiria o sender, que iria
      // tentar POST para a bridge.
      const isMqtt = scenario === "a4";
      return startEsp32Simulator({
        architecture: scenario,
        baseUrl: isMqtt ? undefined : baseUrl,
        brokerUrl: isMqtt ? brokerUrl : undefined,
        intervalMs,
        durationSec,
        deviceId,
        apiKey: isMqtt ? "" : apiKey,
        label: `esp32-sim-${scenario}-${intervalMs}ms`,
      });
    },
    async afterObserve(handle) {
      await stopEsp32Simulator(handle);
    },
  };
}

// Wrapper que padroniza o tratamento de erro global por cenario: loga
// e re-lanca se continueOnError=false. Mantem cada handler de cenario
// focado no "como subir/derrubar", sem repetir try/catch identico.
async function runScenarioSafely({ label, source, continueOnError, run }) {
  try {
    await run();
  } catch (error) {
    console.warn(
      `[orchestrator] ${label} (${source}) falhou globalmente: ${error.message}. ${continueOnError ? "Seguindo." : ""}`
    );
    if (!continueOnError) throw error;
  }
}

// Cada runX abaixo eh responsavel por subir/derrubar a infra da
// arquitetura e chamar o runner especifico. Cenarios filtrados (sem
// intervalos definidos) sao ignorados em silencio para que CAMPAIGNS
// como "coldstart" (so A3) nao precisem espelhar listas vazias.

async function runBackendScenarios({ ctx, modes }) {
  console.log(
    `\n[orchestrator] ===== Cenarios backend-node (${modes.map((m) => m.label).join("+")}) / source=${ctx.source} =====`
  );
  const backendSource = backendSourceFor(ctx.source);
  const backend = await startBackend({ source: backendSource, port: ctx.backendPort });
  try {
    for (const { scenario, mode, label } of modes) {
      const intervals = ctx.scenarioIntervalsMs[scenario];
      if (!intervals?.length) continue;
      console.log(`\n[orchestrator] --- ${label} / source=${ctx.source} ---`);
      await runBackendCampaign({
        baseUrl: `http://localhost:${ctx.backendPort}`,
        mode,
        source: ctx.source,
        reps: ctx.reps,
        durationSeconds: ctx.durationSeconds,
        intervalsMs: intervals,
        campaignType: ctx.campaign.type,
        resultsDir: ctx.resultsDir,
        resume: ctx.resume,
        continueOnError: ctx.continueOnError,
        heartbeatIntervalMs: ctx.heartbeatIntervalMs,
        intervalLifecycle: ctx.useSimulator
          ? makeEsp32SimulatorLifecycle({ scenario })
          : null,
      });
    }
  } finally {
    await stop(backend);
  }
}

async function runServerlessScenario({ ctx }) {
  const intervals = ctx.scenarioIntervalsMs.a3;
  if (!intervals?.length) return;
  console.log(`\n[orchestrator] ===== Cenario A3 (serverless) / source=${ctx.source} =====`);

  let serverlessHandle;
  let resolvedBaseUrl;
  if (ctx.serverlessBaseUrl) {
    serverlessHandle = await attachServerless({ baseUrl: ctx.serverlessBaseUrl });
    resolvedBaseUrl = serverlessHandle.baseUrl;
  } else {
    serverlessHandle = await startServerless({ port: ctx.serverlessPort });
    resolvedBaseUrl = `http://localhost:${ctx.serverlessPort}`;
  }
  try {
    await runServerlessCampaign({
      baseUrl: resolvedBaseUrl,
      apiKey: ctx.serverlessApiKey,
      source: ctx.source,
      reps: ctx.reps,
      durationSeconds: ctx.durationSeconds,
      intervalsMs: intervals,
      campaignType: ctx.campaign.type,
      resultsDir: ctx.resultsDir,
      resume: ctx.resume,
      continueOnError: ctx.continueOnError,
      heartbeatIntervalMs: ctx.heartbeatIntervalMs,
      forceColdStartMs: ctx.coldStartDelayMs,
      intervalLifecycle: ctx.useSimulator
        ? makeEsp32SimulatorLifecycle({ scenario: "a3", apiKey: ctx.serverlessApiKey })
        : null,
    });
  } finally {
    await stop(serverlessHandle);
  }
}

async function runMqttScenario({ ctx }) {
  const intervals = ctx.scenarioIntervalsMs.a4;
  if (!intervals?.length) return;
  console.log(`\n[orchestrator] ===== Cenario A4 (MQTT) / source=${ctx.source} =====`);

  const brokerHandle = await startMqttBroker();
  let bridgeHandle = null;
  try {
    bridgeHandle = await startMqttBridge({
      port: ctx.mqttBridgePort,
      brokerUrl: "mqtt://localhost:1883",
      extraEnv: brokerHandle?.env ?? {},
    });
    try {
      await runMqttCampaign({
        baseUrl: bridgeHandle.baseUrl,
        source: ctx.source,
        reps: ctx.reps,
        durationSeconds: ctx.durationSeconds,
        intervalsMs: intervals,
        campaignType: ctx.campaign.type,
        resultsDir: ctx.resultsDir,
        resume: ctx.resume,
        continueOnError: ctx.continueOnError,
        heartbeatIntervalMs: ctx.heartbeatIntervalMs,
        intervalLifecycle: ctx.useSimulator
          ? makeEsp32SimulatorLifecycle({ scenario: "a4" })
          : null,
      });
    } finally {
      await stopMqttBridge(bridgeHandle);
    }
  } finally {
    await stopMqttBroker(brokerHandle);
  }
}

async function runCampaignForSource(ctx) {
  console.log(`\n[orchestrator] ##### Fonte: ${ctx.source} #####`);
  if (ctx.source === "wifi-http") {
    console.log(
      "[orchestrator] Verifique se o ESP32 esta ligado, conectado ao Wi-Fi e apontando para o endpoint do cenario atual."
    );
  }
  if (ctx.useSimulator) {
    console.log(
      "[orchestrator] Modo simulator-http: backend/serverless subira em wifi-http e o esp32-simulator.mjs sera spawnado a cada intervalo."
    );
  }

  const wantsA1 = ctx.scenarios.includes("a1");
  const wantsA2 = ctx.scenarios.includes("a2");
  const backendModes = [];
  if (wantsA1) backendModes.push({ scenario: "a1", mode: "websocket",    label: "A1 (WebSocket)" });
  if (wantsA2) backendModes.push({ scenario: "a2", mode: "rest-polling", label: "A2 (REST polling)" });

  if (backendModes.length > 0) {
    await runScenarioSafely({
      label: "Backend",
      source: ctx.source,
      continueOnError: ctx.continueOnError,
      run: () => runBackendScenarios({ ctx, modes: backendModes }),
    });
  }

  if (ctx.scenarios.includes("a3")) {
    await runScenarioSafely({
      label: "Serverless",
      source: ctx.source,
      continueOnError: ctx.continueOnError,
      run: () => runServerlessScenario({ ctx }),
    });
  }

  if (ctx.scenarios.includes("a4")) {
    await runScenarioSafely({
      label: "MQTT",
      source: ctx.source,
      continueOnError: ctx.continueOnError,
      run: () => runMqttScenario({ ctx }),
    });
  }
}

// Toda a configuracao da campanha eh resolvida aqui em UM unico objeto
// para evitar a explosao de parametros que o orquestrador tinha antes
// (15+ args sendo passados por chamada). Isso tambem cumpre o papel de
// snapshot do "run" -- util quando o operador precisa reconstruir o
// cenario de uma rodada antiga a partir do log.
function buildCampaignContext(args) {
  const source = normalizeSource(args);
  const campaign = resolveCampaign(args);
  const scenarios = parseList(args.scenarios, ["a1", "a2", "a3"]).map((s) => s.toLowerCase());
  return {
    source,
    campaign,
    scenarios,
    reps: parsePositiveInt(args.reps, 3),
    durationSeconds: parsePositiveInt(args.duration, 60),
    scenarioIntervalsMs: {
      a1: resolveScenarioIntervals({ args, campaign, scenario: "a1" }),
      a2: resolveScenarioIntervals({ args, campaign, scenario: "a2" }),
      a3: resolveScenarioIntervals({ args, campaign, scenario: "a3" }),
      a4: resolveScenarioIntervals({ args, campaign, scenario: "a4" }),
    },
    resultsDir: resolve(rootDir, args["results-dir"] ?? "resultados"),
    backendPort: parsePositiveInt(args["port-backend"], 3000),
    serverlessPort: parsePositiveInt(args["port-serverless"], 3001),
    mqttBridgePort: parsePositiveInt(args["port-mqtt-bridge"], 4002),
    serverlessBaseUrl: args["serverless-base-url"] ?? process.env.SERVERLESS_BASE_URL ?? null,
    serverlessApiKey: args["serverless-api-key"] ?? process.env.INGEST_API_KEY ?? "",
    coldStartDelayMs: parseNonNegativeInt(args["cold-start-delay-ms"], 0),
    skipAnalysis: Boolean(args["skip-analysis"]),
    resume: !args["no-resume"],
    continueOnError: !args["no-continue-on-error"],
    keepAwakeEnabled: !args["no-keep-awake"],
    heartbeatIntervalMs: parseNonNegativeInt(args["heartbeat-ms"], 10_000),
    useSimulator: usesEsp32Simulator(normalizeSource(args)),
  };
}

function printCampaignContext(ctx) {
  console.log(`[orchestrator] Configuracao:`);
  console.log(`  source             = ${ctx.source}`);
  console.log(`  campaign           = ${ctx.campaign.type} (${ctx.campaign.description})`);
  console.log(`  reps               = ${ctx.reps}`);
  console.log(`  duration           = ${ctx.durationSeconds}s`);
  console.log(`  scenarios          = ${ctx.scenarios.join(", ")}`);
  for (const s of ["a1", "a2", "a3", "a4"]) {
    console.log(`  intervals[${s}]      = ${ctx.scenarioIntervalsMs[s].join(", ")} ms`);
  }
  console.log(`  resultsDir         = ${ctx.resultsDir}`);
  console.log(`  backendPort        = ${ctx.backendPort}`);
  console.log(`  serverlessBaseUrl  = ${ctx.serverlessBaseUrl ?? `(local) http://localhost:${ctx.serverlessPort}`}`);
  console.log(`  mqttBridgePort     = ${ctx.mqttBridgePort}`);
  console.log(`  coldStartDelayMs   = ${ctx.coldStartDelayMs}`);
  console.log(`  resume             = ${ctx.resume}`);
  console.log(`  continueOnError    = ${ctx.continueOnError}`);
  console.log(`  keepAwake          = ${ctx.keepAwakeEnabled}`);
}

// Analise opcional pos-campanha. Falha silenciosa eh deliberada: os
// CSV/JSON brutos ja foram salvos pelo orquestrador, entao perder
// consolidacao/grafico nao deve mascarar o sucesso da coleta.
async function runPostCampaignAnalysis(resultsDir) {
  console.log(`\n[orchestrator] ===== Consolidando resultados =====`);
  try {
    await runPython("consolidate_results.py", [resultsDir]);
    await runPython("plot_results.py", [resultsDir]);
  } catch (error) {
    console.warn(
      `[orchestrator] Analise opcional falhou (${error.message}). Resultados brutos ja foram salvos.`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (args["log-file"]) initLogFile(resolve(rootDir, args["log-file"]));

  const ctx = buildCampaignContext(args);
  printCampaignContext(ctx);

  const keepAwake = ctx.keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    await runScenarioSafely({
      label: `Fonte '${ctx.source}'`,
      source: ctx.source,
      continueOnError: ctx.continueOnError,
      run: () => runCampaignForSource(ctx),
    });

    if (ctx.skipAnalysis) {
      console.log("[orchestrator] --skip-analysis: pulei consolidate/plot.");
    } else {
      await runPostCampaignAnalysis(ctx.resultsDir);
    }

    console.log(`\n[orchestrator] Concluido. CSV/JSON em ${ctx.resultsDir}.`);
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
