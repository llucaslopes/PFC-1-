#!/usr/bin/env node
/**
 * Campanha de escalabilidade horizontal: multiplos clientes simultaneos.
 *
 * Para cada combinacao (modo, intervalo do produtor, numero de clientes,
 * repeticao), inicia o backend, sobe N clientes paralelos (WebSocket ou
 * REST polling), coleta CPU/RAM via /health/process e mede latencia por
 * cliente usando o mesmo sync NTP/Cristian da campanha principal.
 *
 * Saidas em resultados/escalabilidade-clientes-2026-05/.
 *
 * NAO modifica resultados existentes nem outras campanhas.
 *
 * Refatorado na Sub-fase 2.2: a logica de cada bloco (clientes WS/REST,
 * sampler de recursos, agregadores, escrita de CSV/JSON, conversao
 * WebSerial->aggregate) vive em `scripts/lib_mjs/multiclient/`. Este
 * arquivo so faz parsing de CLI + orquestracao.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startKeepAwake } from './lib/keep-awake.mjs';
import { initLogFile } from './lib/runtime-utils.mjs';
import { resolveSerialPort } from './lib/serial-detect.mjs';
import { startWebserial, stop } from './lib/server-control.mjs';
import { bootstrapSerialPermission } from './lib/webserial-runner.mjs';

import {
  parseArgs,
  parseIntList,
  parseList,
  parsePositiveInt,
} from './lib_mjs/cli-args.mjs';
import {
  runBackendBlock,
  runWebserialBlock,
} from './lib_mjs/multiclient/run-blocks.mjs';
import { consolidateAll } from './lib_mjs/multiclient/reporter.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CAMPAIGN = {
  type: 'scalability-clients',
  name: 'escalabilidade-clientes-2026-05',
  intervalsMs: [100, 50, 20, 10, 5],
  clientCounts: [1, 2, 5, 10, 20],
  modes: ['websocket', 'rest-polling', 'webserial'],
  defaultReps: 3,
  defaultDurationSeconds: 60,
  resourceSampleIntervalMs: 500,
  // WebSerial e single-client por design (Web Serial API e exclusiva por porta).
  // Na campanha multi-cliente ele entra apenas em N=1 para servir de baseline
  // arquitetural lado a lado com WS/REST nesse mesmo numero de clientes.
  webserialClientCount: 1,
};

function printHelp() {
  console.log(`Uso: node scripts/run-multiclient-scalability.mjs [opcoes]

Mede escalabilidade horizontal (multiplos clientes simultaneos) para WebSocket
e REST polling. WebSerial tambem pode ser incluido, mas APENAS em N=1 cliente
(restricao arquitetural: a Web Serial API e exclusiva por porta serial; rodar
N>1 navegadores conectados a uma unica porta e impossivel sem replicar o
hardware). Quando 'webserial' esta entre os modos, qualquer --clients diferente
de 1 e ignorado para esse modo (usado N=1 fixo) e o backend Node nao roda.

Matriz default:
  modes              websocket, rest-polling, webserial
  intervals (ms)     100, 50, 20, 10, 5
  clients            1, 2, 5, 10, 20  (webserial usa apenas 1)
  reps               3
  duration           60 s
  total              5 x 5 x 3 x 2 (WS+REST) + 5 x 1 x 3 (webserial) = 165 execucoes

Opcoes:
  --source serial|simulator     fonte das amostras (default: serial)
  --serial-port COM3|auto       porta do Arduino (default: auto)
  --reps 3                      repeticoes (default: 3)
  --duration 60                 segundos por execucao (default: 60)
  --intervals 100,50,20,10,5    sobrescreve a matriz de intervalos
  --clients 1,2,5,10,20         sobrescreve a matriz de clientes (webserial sempre 1)
  --modes websocket,rest-polling,webserial
                                modos a testar (default: todos)
  --campaign-dir <path>         destino dos arquivos
  --port-backend 3000           porta do backend (WS/REST)
  --port-webserial 8765         porta do servidor estatico do prototipo WebSerial
  --chromium-user-data <path>   perfil persistente do Playwright/Chromium
  --no-auto-bootstrap           nao autoriza a porta serial automaticamente
  --bootstrap-webserial         abre o Chrome para autorizar a porta serial e sai
  --log-file logs/multiclient.log
  --no-resume                   refaz execucoes ja completas
  --no-keep-awake               nao impede o Windows de dormir
  --skip-analysis               nao roda plot_multiclient.py
  --help

Exemplos:
  npm run experiment:multiclient
  node scripts/run-multiclient-scalability.mjs --serial-port COM3
  node scripts/run-multiclient-scalability.mjs --modes websocket --clients 1,5,10
  node scripts/run-multiclient-scalability.mjs --modes webserial --intervals 100
  node scripts/run-multiclient-scalability.mjs --source simulator --reps 1     # sanity
`);
}

function runPython(scriptName, args = []) {
  return new Promise((resolveRun, rejectRun) => {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(pythonCmd, [resolve(rootDir, 'scripts', scriptName), ...args], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('exit', (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${scriptName} saiu com codigo ${code}`));
    });
    child.on('error', rejectRun);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args['log-file']) {
    initLogFile(resolve(rootDir, args['log-file']));
  }

  const source = args.source === 'simulator' ? 'simulator' : 'serial';
  const serialPortConfigured = args['serial-port'] ?? process.env.SERIAL_PORT ?? 'auto';
  const reps = parsePositiveInt(args.reps, CAMPAIGN.defaultReps);
  const durationSeconds = parsePositiveInt(args.duration, CAMPAIGN.defaultDurationSeconds);
  const intervalsMs = parseIntList(args.intervals, CAMPAIGN.intervalsMs);
  const clientCounts = parseIntList(args.clients, CAMPAIGN.clientCounts);
  const modes = parseList(args.modes, CAMPAIGN.modes).map((m) => m.toLowerCase());
  const campaignDir = resolve(rootDir,
    args['campaign-dir'] ?? `resultados/${CAMPAIGN.name}`);
  const backendPort = parsePositiveInt(args['port-backend'], 3000);
  const webserialPort = parsePositiveInt(args['port-webserial'], 8765);
  const userDataDir = resolve(rootDir, args['chromium-user-data'] ?? '.playwright-profile');
  const skipAnalysis = Boolean(args['skip-analysis']);
  const resume = !args['no-resume'];
  const keepAwakeEnabled = !args['no-keep-awake'];
  const autoBootstrap = !args['no-auto-bootstrap'];

  for (const m of modes) {
    if (!CAMPAIGN.modes.includes(m)) {
      throw new Error(`Modo invalido: ${m}. Use: ${CAMPAIGN.modes.join(', ')}.`);
    }
  }

  if (!existsSync(campaignDir)) mkdirSync(campaignDir, { recursive: true });

  if (args['bootstrap-webserial']) {
    const webserialServer = await startWebserial({ port: webserialPort });
    try {
      await bootstrapSerialPermission({
        baseUrl: `http://localhost:${webserialPort}/`,
        userDataDir,
      });
    } finally {
      await stop(webserialServer);
    }
    return;
  }

  const backendModes = modes.filter((m) => m !== 'webserial');
  const includesWebserial = modes.includes('webserial');
  const backendRuns =
    backendModes.length * intervalsMs.length * clientCounts.length * reps;
  const webserialRuns = includesWebserial ? intervalsMs.length * reps : 0;
  const totalRuns = backendRuns + webserialRuns;
  const totalSeconds = totalRuns * durationSeconds;
  const estimatedMinutes = Math.ceil(totalSeconds / 60);

  const resolvedSerialPort =
    source === 'serial' ? await resolveSerialPort(serialPortConfigured) : null;
  if (source === 'serial' && !resolvedSerialPort) {
    console.warn(
      `[multiclient] Fonte serial sem porta COM detectada. Conecte o Arduino ou use --source simulator.`
    );
    return;
  }

  console.log('[multiclient] ============================================================');
  console.log(`[multiclient] Campanha: ${CAMPAIGN.name} (type=${CAMPAIGN.type})`);
  console.log(`[multiclient] ------------------------------------------------------------`);
  console.log(`  source           = ${source}${source === 'serial' ? ` (${resolvedSerialPort})` : ''}`);
  console.log(`  modes            = ${modes.join(', ')}`);
  console.log(`  intervals (ms)   = ${intervalsMs.join(', ')}`);
  console.log(`  clients          = ${clientCounts.join(', ')} (webserial sempre N=1)`);
  console.log(`  reps             = ${reps}`);
  console.log(`  duration (s)     = ${durationSeconds}`);
  console.log(`  backend runs     = ${backendRuns} (WS/REST: ${backendModes.join(', ') || '-'})`);
  console.log(`  webserial runs   = ${webserialRuns}`);
  console.log(`  total execucoes  = ${totalRuns}`);
  console.log(`  duracao estimada = ~${estimatedMinutes} min de coleta`);
  console.log(`  campaignDir      = ${campaignDir}`);
  console.log(`  resume           = ${resume}`);
  console.log(`  keepAwake        = ${keepAwakeEnabled}`);
  console.log(`  autoBootstrap    = ${autoBootstrap}`);
  console.log(`  skipAnalysis     = ${skipAnalysis}`);
  console.log('[multiclient] ============================================================\n');

  const keepAwake = keepAwakeEnabled ? startKeepAwake() : { stop() {} };

  try {
    for (const mode of modes) {
      try {
        if (mode === 'webserial') {
          await runWebserialBlock({
            campaignDir, intervalsMs, clientCounts, reps, durationSeconds,
            source, webserialPort, userDataDir, autoBootstrap, resume,
            campaign: CAMPAIGN,
          });
        } else {
          await runBackendBlock({
            mode, campaignDir, intervalsMs, clientCounts, reps, durationSeconds,
            source, resolvedSerialPort, backendPort, resume,
            campaign: CAMPAIGN,
          });
        }
      } catch (error) {
        console.warn(
          `[multiclient] Modo '${mode}' falhou em alto nivel: ${error.message}. Seguindo para o proximo.`
        );
      }
    }

    consolidateAll(campaignDir, CAMPAIGN);

    if (!skipAnalysis) {
      try {
        await runPython('plot_multiclient.py', [campaignDir]);
      } catch (error) {
        console.warn(
          `[multiclient] Pos-processamento opcional falhou (${error.message}). CSV/JSON estao salvos.`
        );
      }
    }

    console.log(`\n[multiclient] Concluido. Arquivos em ${campaignDir}.`);
  } finally {
    keepAwake.stop();
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[multiclient] ERRO: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
