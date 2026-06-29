#!/usr/bin/env node
// Gerador de carga local que substitui o ESP32 real para validacao
// de pipeline. Emite o mesmo payload JSON do firmware e bate nos
// mesmos endpoints, o que permite reproduzir a campanha em CI ou em
// uma maquina sem hardware. Os arquivos resultantes ficam marcados
// com source=simulator-http para nao serem confundidos com dados
// oficiais -- a latencia medida via simulador local rodando em
// loopback eh ordens de magnitude menor do que a observada com o
// ESP32 sobre Wi-Fi e nao deve ser usada como evidencia no relatorio.

import fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, parsePositiveInt } from "./lib_mjs/cli-args.mjs";
import { runSimulator } from "./lib_mjs/esp32-simulator/runner.mjs";
import {
  createBackendHttpSender,
  createMqttSender,
  createServerlessHttpSender,
} from "./lib_mjs/esp32-simulator/senders.mjs";

const SUPPORTED_ARCHS = new Set(["a1", "a2", "a3", "a4"]);

function printHelp() {
  console.log(`Uso: node scripts/esp32-simulator.mjs [opcoes]

Opcoes obrigatorias:
  --architecture a1|a2|a3|a4   arquitetura alvo
                                  a1/a2 -> POST {baseUrl}/ingest/sensor
                                  a3    -> POST {baseUrl}/api/ingest
                                  a4    -> MQTT publish em {brokerUrl}

Opcoes comuns:
  --device-id esp32-01          identificador do dispositivo simulado
                                  (default igual ao firmware p/ casar com os runners)
  --interval-ms 100             intervalo entre envios (ms)
  --duration-sec 60             duracao do envio (segundos)
  --summary-json <path>         grava resumo final em JSON

Opcoes A1/A2/A3 (HTTP):
  --base-url http://localhost:3000  URL base do servidor
                                       A1/A2 default: http://localhost:3000
                                       A3    default: http://localhost:3001
  --api-key <token>             header X-Api-Key (opcional)
  --timeout-ms 5000             timeout por request HTTP

Opcoes A4 (MQTT):
  --broker-url mqtt://localhost:1883  URL do broker MQTT
  --topic iot/{deviceId}/sensor       template do topico
  --mqtt-username <u>           usuario opcional
  --mqtt-password <p>           senha opcional
  --mqtt-qos 0|1|2              QoS (default 0)

Outros:
  --help                        mostra esta mensagem

Exemplos:
  node scripts/esp32-simulator.mjs --architecture a1 --interval-ms 100 --duration-sec 10
  node scripts/esp32-simulator.mjs --architecture a3 --base-url http://localhost:3001 --duration-sec 5
  node scripts/esp32-simulator.mjs --architecture a4 --broker-url mqtt://localhost:1883 --duration-sec 5
`);
}

async function buildSender(args, architecture) {
  if (architecture === "a1" || architecture === "a2") {
    const baseUrl = args["base-url"] ?? "http://localhost:3000";
    return createBackendHttpSender({
      architecture,
      baseUrl,
      apiKey: args["api-key"] ?? process.env.INGEST_API_KEY ?? "",
      timeoutMs: parsePositiveInt(args["timeout-ms"], 5000),
    });
  }
  if (architecture === "a3") {
    const baseUrl = args["base-url"] ?? "http://localhost:3001";
    return createServerlessHttpSender({
      baseUrl,
      apiKey: args["api-key"] ?? process.env.INGEST_API_KEY ?? "",
      timeoutMs: parsePositiveInt(args["timeout-ms"], 5000),
    });
  }
  if (architecture === "a4") {
    const brokerUrl = args["broker-url"] ?? "mqtt://localhost:1883";
    const deviceId = args["device-id"] ?? "esp32-01";
    const qosRaw = Number(args["mqtt-qos"] ?? 0);
    const qos = qosRaw === 1 || qosRaw === 2 ? qosRaw : 0;
    return createMqttSender({
      brokerUrl,
      deviceId,
      topicTemplate: args.topic ?? "iot/{deviceId}/sensor",
      username: args["mqtt-username"],
      password: args["mqtt-password"],
      qos,
    });
  }
  throw new Error(`architecture invalida: ${architecture}`);
}

function buildProgressLogger() {
  let lastSeq = 0;
  let lastWallMs = Date.now();
  return ({ totalAttempts, totalAccepted, httpStatus, rttMs, intervalMs }) => {
    const now = Date.now();
    const elapsedSec = Math.max(0.001, (now - lastWallMs) / 1000);
    const ratePerSec = (totalAttempts - lastSeq) / elapsedSec;
    lastSeq = totalAttempts;
    lastWallMs = now;
    console.log(
      `[esp32-sim] seq=${totalAttempts} accepted=${totalAccepted} ` +
        `rate=${ratePerSec.toFixed(1)}/s rtt_avg=${rttMs.avg ?? "n/a"}ms ` +
        `2xx=${httpStatus["2xx"]} 4xx=${httpStatus["4xx"]} 5xx=${httpStatus["5xx"]} ` +
        `net_err=${httpStatus.network_error} target_int=${intervalMs}ms`
    );
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const architecture = String(args.architecture ?? "").toLowerCase();
  if (!SUPPORTED_ARCHS.has(architecture)) {
    console.error(
      `[esp32-sim] ERRO: --architecture obrigatorio (a1|a2|a3|a4). Recebido: '${architecture || "(vazio)"}'.\n`
    );
    printHelp();
    process.exitCode = 2;
    return;
  }

  // O default precisa casar com DEVICE_ID em secrets.h.example. Os
  // runners filtram amostras por deviceId, entao mudar aqui sem mudar
  // la faria os simuladores aparecerem como zero amostras recebidas
  // mesmo com a rede saudavel.
  const deviceId = String(args["device-id"] ?? "esp32-01");
  const intervalMs = parsePositiveInt(args["interval-ms"], 100);
  const durationSec = parsePositiveInt(args["duration-sec"], 60);
  const summaryJsonPath = args["summary-json"]
    ? resolve(process.cwd(), String(args["summary-json"]))
    : null;

  console.log(
    `[esp32-sim] architecture=${architecture} device=${deviceId} ` +
      `interval=${intervalMs}ms duration=${durationSec}s`
  );

  const sender = await buildSender(args, architecture);
  console.log(`[esp32-sim] target=${sender.endpoint}`);

  const controller = new AbortController();
  const onInterrupt = () => {
    console.log("\n[esp32-sim] sinal recebido; finalizando loop...");
    controller.abort();
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  let summary;
  try {
    summary = await runSimulator({
      sender,
      deviceId,
      intervalMs,
      durationSec,
      onProgress: buildProgressLogger(),
      progressEveryN: Math.max(10, Math.floor(1000 / intervalMs)),
      signal: controller.signal,
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }

  console.log("\n[esp32-sim] ===== resumo =====");
  console.log(`  target               ${summary.sender.endpoint}`);
  console.log(`  totalAttempts        ${summary.totalAttempts}`);
  console.log(`  totalAccepted        ${summary.totalAccepted}`);
  console.log(`  localDrops           ${summary.localDrops}`);
  console.log(
    `  httpStatus           2xx=${summary.httpStatus["2xx"]} ` +
      `4xx=${summary.httpStatus["4xx"]} ` +
      `5xx=${summary.httpStatus["5xx"]} ` +
      `net_err=${summary.httpStatus.network_error}`
  );
  console.log(
    `  rttMs                avg=${summary.rttMs.avg} min=${summary.rttMs.min} ` +
      `p95=${summary.rttMs.p95} max=${summary.rttMs.max} (n=${summary.rttMs.count})`
  );
  if (summary.firstErrorSample) {
    console.log(`  firstErrorSample     ${summary.firstErrorSample}`);
  }

  if (summaryJsonPath) {
    await fs.mkdir(dirname(summaryJsonPath), { recursive: true });
    await fs.writeFile(summaryJsonPath, JSON.stringify(summary, null, 2), "utf8");
    console.log(`[esp32-sim] resumo salvo em ${summaryJsonPath}`);
  }

  // Saude da rodada: 90% de aceite e <10% de erro de rede. Os limites
  // tolerantes sao deliberados -- localhost real costuma bater 99%+, mas
  // o simulador eh executado tambem em CI onde resource starvation pode
  // fazer cair a 95% sem que seja indicativo de bug.
  const ok =
    summary.totalAccepted > 0 &&
    summary.totalAccepted >= summary.totalAttempts * 0.9 &&
    summary.httpStatus.network_error < summary.totalAttempts * 0.1;
  process.exitCode = ok ? 0 : 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[esp32-sim] ERRO: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}

// Reexportadas para que testes possam montar/exercer o sender e o loop
// sem ter que invocar o CLI por subprocesso.
export { buildSender, runSimulator };
