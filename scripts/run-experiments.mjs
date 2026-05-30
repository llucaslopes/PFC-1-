#!/usr/bin/env node
import { spawn } from "node:child_process";
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

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[name] = true;
    } else {
      args[name] = next;
      index++;
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
  return parts.map((part) => Number(part)).filter((part) => Number.isFinite(part) && part > 0);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp() {
  console.log(`Uso: node scripts/run-experiments.mjs [opcoes]

Opcoes (todas tem default sensato; rodar sem nada ja executa a campanha completa):
  --sources serial,simulator    fontes a rodar em sequencia (default: serial,simulator)
  --source serial|simulator     atalho para uma unica fonte (sobrescreve --sources)
  --serial-port COM3|auto       (default: auto; usa env SERIAL_PORT se definida)
  --reps 3                      numero de repeticoes
  --duration 60                 segundos por intervalo
  --intervals 100,50,20,10,5,1  campanha stress
  --scenarios c1,c2,c3          quais cenarios executar
  --results-dir resultados      diretorio dos CSV/JSON
  --port-backend 3000
  --port-webserial 8765
  --chromium-user-data <path>   default: .playwright-profile/
  --log-file logs/run.log       tee de stdout/stderr para arquivo
  --heartbeat-ms 10000          intervalo do heartbeat; 0 desliga
  --no-resume                   nao pula reps cujos arquivos ja existem
  --no-continue-on-error        aborta tudo na primeira falha
  --no-keep-awake               nao impede sleep do Windows durante o run
  --no-auto-bootstrap           nao tenta autorizar a porta serial automaticamente
  --skip-analysis               nao roda consolidate_results.py + plot_results.py
  --bootstrap-webserial         so abre Chrome para autorizar a porta serial e sai
  --help

Exemplos:
  node scripts/run-experiments.mjs                                 # tudo automatico
  node scripts/run-experiments.mjs --sources simulator              # so simulador
  node scripts/run-experiments.mjs --scenarios c2,c3 --reps 5       # backend, 5 reps
  node scripts/run-experiments.mjs --bootstrap-webserial            # so autoriza a porta
`);
}

async function runPython(scriptName, args = []) {
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

function normalizeSources(args) {
  if (args.source) {
    return [args.source === "simulator" ? "simulator" : "serial"];
  }
  const list = parseList(args.sources, ["serial", "simulator"]).map((s) =>
    s === "simulator" ? "simulator" : "serial"
  );
  return [...new Set(list)];
}

async function runCampaignForSource({
  source,
  scenarios,
  reps,
  durationSeconds,
  intervalsMs,
  resultsDir,
  backendPort,
  webserialPort,
  userDataDir,
  resume,
  continueOnError,
  heartbeatIntervalMs,
  autoBootstrap,
  serialPortConfigured
}) {
  console.log(`\n[orchestrator] ##### Fonte: ${source} #####`);

  const resolvedSerialPort =
    source === "serial" ? await resolveSerialPort(serialPortConfigured) : null;

  if (source === "serial" && !resolvedSerialPort) {
    console.warn(
      `[orchestrator] Fonte serial sem porta COM detectada. Verifique se o Arduino esta conectado. Pulando fonte 'serial'.`
    );
    return;
  }

  if (source === "serial") {
    console.log(`[orchestrator] Porta serial: ${resolvedSerialPort}`);
  }

  const wantsC1 = scenarios.includes("c1");
  const wantsC2 = scenarios.includes("c2");
  const wantsC3 = scenarios.includes("c3");

  if (wantsC1) {
    console.log(`\n[orchestrator] ===== Cenario C1 (WebSerial) / source=${source} =====`);
    try {
      const webserial = await startWebserial({ port: webserialPort });
      try {
        const baseUrl = `http://localhost:${webserialPort}/`;
        if (source === "serial" && autoBootstrap) {
          const granted = await hasSerialPermission({ baseUrl, userDataDir });
          if (!granted) {
            console.log(
              "[orchestrator] WebSerial sem permissao salva; abrindo bootstrap automatico."
            );
            await bootstrapSerialPermission({ baseUrl, userDataDir });
          }
        }

        await runWebserialCampaign({
          baseUrl,
          source,
          reps,
          durationSeconds,
          intervalsMs,
          resultsDir,
          userDataDir,
          resume,
          continueOnError,
          heartbeatIntervalMs
        });
      } finally {
        await stop(webserial);
      }
    } catch (error) {
      console.warn(
        `[orchestrator] Cenario C1 (${source}) falhou: ${error.message}. ${continueOnError ? "Seguindo." : ""}`
      );
      if (!continueOnError) throw error;
    }
  }

  if (wantsC2 || wantsC3) {
    console.log(`\n[orchestrator] ===== Cenarios backend-node / source=${source} =====`);
    try {
      const backend = await startBackend({
        source,
        serialPort: resolvedSerialPort,
        port: backendPort
      });
      try {
        if (wantsC2) {
          console.log(`\n[orchestrator] --- C2 (WebSocket) / source=${source} ---`);
          await runBackendCampaign({
            baseUrl: `http://localhost:${backendPort}`,
            mode: "websocket",
            source,
            reps,
            durationSeconds,
            intervalsMs,
            resultsDir,
            resume,
            continueOnError,
            heartbeatIntervalMs
          });
        }
        if (wantsC3) {
          console.log(`\n[orchestrator] --- C3 (REST polling) / source=${source} ---`);
          await runBackendCampaign({
            baseUrl: `http://localhost:${backendPort}`,
            mode: "rest-polling",
            source,
            reps,
            durationSeconds,
            intervalsMs,
            resultsDir,
            resume,
            continueOnError,
            heartbeatIntervalMs
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

  const sources = normalizeSources(args);
  const serialPortConfigured =
    args["serial-port"] ?? process.env.SERIAL_PORT ?? "auto";
  const reps = parsePositiveInt(args.reps, 3);
  const durationSeconds = parsePositiveInt(args.duration, 60);
  const intervalsMs = parseIntervals(args.intervals, [100, 50, 20, 10, 5, 1]);
  const scenarios = parseList(args.scenarios, ["c1", "c2", "c3"]).map((s) => s.toLowerCase());
  const resultsDir = resolve(rootDir, args["results-dir"] ?? "resultados");
  const backendPort = parsePositiveInt(args["port-backend"], 3000);
  const webserialPort = parsePositiveInt(args["port-webserial"], 8765);
  const userDataDir = resolve(
    rootDir,
    args["chromium-user-data"] ?? ".playwright-profile"
  );
  const skipAnalysis = Boolean(args["skip-analysis"]);
  const resume = !args["no-resume"];
  const continueOnError = !args["no-continue-on-error"];
  const keepAwakeEnabled = !args["no-keep-awake"];
  const autoBootstrap = !args["no-auto-bootstrap"];
  const heartbeatIntervalMs = Math.max(0, parsePositiveInt(args["heartbeat-ms"], 10_000));

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

  console.log(`[orchestrator] Configuracao:`);
  console.log(`  sources            = ${sources.join(", ")}`);
  console.log(`  serialPort         = ${serialPortConfigured} (resolvido por fonte)`);
  console.log(`  reps               = ${reps}`);
  console.log(`  duration           = ${durationSeconds}s`);
  console.log(`  intervals          = ${intervalsMs.join(", ")} ms`);
  console.log(`  scenarios          = ${scenarios.join(", ")}`);
  console.log(`  resultsDir         = ${resultsDir}`);
  console.log(`  userDataDir        = ${userDataDir}`);
  console.log(`  resume             = ${resume}`);
  console.log(`  continueOnError    = ${continueOnError}`);
  console.log(`  keepAwake          = ${keepAwakeEnabled}`);
  console.log(`  autoBootstrap      = ${autoBootstrap}`);
  console.log(`  heartbeatMs        = ${heartbeatIntervalMs}`);
  if (args["log-file"]) {
    console.log(`  logFile            = ${resolve(rootDir, args["log-file"])}`);
  }

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    for (const source of sources) {
      try {
        await runCampaignForSource({
          source,
          scenarios,
          reps,
          durationSeconds,
          intervalsMs,
          resultsDir,
          backendPort,
          webserialPort,
          userDataDir,
          resume,
          continueOnError,
          heartbeatIntervalMs,
          autoBootstrap,
          serialPortConfigured
        });
      } catch (error) {
        console.warn(
          `[orchestrator] Fonte '${source}' falhou globalmente: ${error.message}. ${continueOnError ? "Seguindo para a proxima fonte." : "Abortando."}`
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
