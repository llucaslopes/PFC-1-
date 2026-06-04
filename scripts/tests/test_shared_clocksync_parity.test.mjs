
/**
 * Paridade comportamental: garante que apos a unificacao em
 * `shared/js/clockSyncMath.js`, cada um dos 3 consumidores ESM (webserial,
 * backend frontend, scripts/lib) continua produzindo OUTPUTS identicos aos
 * fixtures originais.
 *
 * O quarto consumidor (`backend/src/utils/clockSyncMath.ts`) tem tipos TS
 * — em vez de tentar transpilar em runtime aqui, validamos via assercao
 * estrutural sobre o source (a formula matematica precisa estar literal
 * no arquivo). A paridade real e garantida por:
 *   - Sub-fase 4.0 (supertest fixtures) que congelara as respostas HTTP.
 *   - Comparacao manual deste teste com vetores deterministicos pre-calculados.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ORIGINALS = join(__dirname, 'baselines-frontend', 'originals');

const ESM_PAIRS = [
  {
    name: 'webserial',
    original: join(ORIGINALS, 'webserial', 'clockSyncMath.js'),
    current: join(REPO_ROOT, 'prototypes', '_legacy_webserial', 'js', 'clockSyncMath.js'),
  },
  {
    name: 'backend-public',
    original: join(ORIGINALS, 'backend', 'clockSyncMath.js'),
    current: join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'public', 'js', 'clockSyncMath.js'),
  },
  {
    name: 'scripts-lib',
    original: join(ORIGINALS, 'scripts-lib', 'clockSyncMath.mjs'),
    current: join(REPO_ROOT, 'scripts', 'lib', 'clockSyncMath.mjs'),
  },
];

async function load(path) {
  return import(pathToFileURL(path).href);
}

const SYNC_VECTORS = [
  { t0: 0, t1: 0, t2: 0, t3: 0, remoteUnit: 'us' },
  { t0: 1000, t1: 1_500_000, t2: 1_500_005, t3: 1010, remoteUnit: 'us' },
  { t0: 5, t1: 7, t2: 12, t3: 20, remoteUnit: 'ms' },
  { t0: 0, t1: 0, t2: 1000, t3: 0.5, remoteUnit: 'ms' },
  { t0: 1000, t1: 999_000_000, t2: 999_001_000, t3: 1003, remoteUnit: 'us' },
];

const SEND_VECTORS = [
  [1000, 'ms', 12.345],
  [1_500_000, 'us', 12.345],
  [0, 'us', -3.14],
  [0, 'ms', 0],
];

const DETECT_VECTORS = [
  [1000, null], [1_000_000, 'us'], [9_999_999, null], [10_000_000, null],
  [12_345_678, 'ms'],
];

const LATENCY_VECTORS = [
  [105, 1000, 'ms', 0],
  [105.5, 1_000_000, 'us', 5.0],
  [50, 1_000_000_000, 'us', -100],
  [10, NaN, 'us', 0],
  [10, 0, 'us', NaN],
];

for (const pair of ESM_PAIRS) {
  test(`${pair.name}: computeCristianSync identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    for (const v of SYNC_VECTORS) {
      assert.deepEqual(cur.computeCristianSync(v), orig.computeCristianSync(v),
        `vector ${JSON.stringify(v)}`);
    }
  });

  test(`${pair.name}: remoteSendToHostMs identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    for (const [s, u, o] of SEND_VECTORS) {
      assert.equal(cur.remoteSendToHostMs(s, u, o), orig.remoteSendToHostMs(s, u, o));
    }
  });

  test(`${pair.name}: detectSendUnit identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    for (const [s, u] of DETECT_VECTORS) {
      assert.equal(cur.detectSendUnit(s, u), orig.detectSendUnit(s, u));
    }
  });

  test(`${pair.name}: computeEndToEndLatency identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    for (const [r, s, u, o] of LATENCY_VECTORS) {
      assert.equal(cur.computeEndToEndLatency(r, s, u, o),
                   orig.computeEndToEndLatency(r, s, u, o),
        `vector r=${r} s=${s} u=${u} o=${o}`);
    }
  });
}

test('backend-ts: formulas matematicas literais preservadas', () => {
  // O backend/src/utils/clockSyncMath.ts e o quarto consumidor (consumido por
  // serial/serialReader.ts em Node TS). Em vez de transpilar dinamicamente,
  // validamos que as formulas-chave estao literalmente no source. Qualquer
  // refatoracao numerica precisa propagar para os 4 arquivos.
  const tsPath = join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'src', 'utils', 'clockSyncMath.ts');
  const txt = readFileSync(tsPath, 'utf8');
  assert.ok(txt.includes('export function computeCristianSync'),
    'backend/src/utils/clockSyncMath.ts perdeu a funcao publica');
  // Formula do offset (Cristian).
  assert.ok(txt.includes('(options.t0 + options.t3) / 2 - (t1Ms + t2Ms) / 2') ||
            txt.includes('(t0 + t3) / 2 - (t1Ms + t2Ms) / 2'),
    'formula de offsetMs alterada no .ts — atualize tambem shared/js/clockSyncMath.js');
  // Formula do RTT.
  assert.ok(txt.includes('(options.t3 - options.t0) - (t2Ms - t1Ms)') ||
            txt.includes('(t3 - t0) - (t2Ms - t1Ms)'),
    'formula de roundTripMs alterada no .ts — atualize tambem shared/js/clockSyncMath.js');
  // Conversao us -> ms.
  assert.ok(/remoteUnit === ["']us["']/.test(txt),
    'comparacao remoteUnit alterada no .ts');
});

test('shared SYNC_VECTORS produzem valores determinisicos esperados', async () => {
  // Vetores deterministicos pre-calculados a partir do algoritmo (Cristian).
  // Servem de "ground truth" para qualquer reimplementacao futura — TS, Python,
  // outra linguagem — bater nesses numeros.
  const shared = await load(join(REPO_ROOT, 'shared', 'js', 'clockSyncMath.js'));

  // t0=1000, t1=1_500_000us=1500ms, t2=1_500_005us=1500.005ms, t3=1010
  // roundTrip = (1010-1000) - (1500.005-1500) = 10 - 0.005 = 9.995
  // offset    = (1000+1010)/2 - (1500+1500.005)/2 = 1005 - 1500.0025 = -495.0025
  // Tolerancia de fp64: float arithmetic produz e-15 residual.
  const r = shared.computeCristianSync({ t0: 1000, t1: 1_500_000, t2: 1_500_005, t3: 1010, remoteUnit: 'us' });
  assert.ok(Math.abs(r.roundTripMs - 9.995) < 1e-9, `roundTrip=${r.roundTripMs}`);
  assert.ok(Math.abs(r.offsetMs - (-495.0025)) < 1e-9, `offset=${r.offsetMs}`);
  assert.ok(Math.abs(r.uncertaintyMs - 4.9975) < 1e-9, `unc=${r.uncertaintyMs}`);
  assert.equal(r.remoteUnit, 'us');
});
