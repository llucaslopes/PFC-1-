
/**
 * Suite unitaria do `scripts/lib_mjs/` + paridade com `scripts/lib_py/`.
 *
 * Para os modulos `scenarios` e `stats`, este teste roda os mesmos casos
 * em JS e em Python (via subprocess) e compara as saidas. Garante que a
 * coleta `.mjs` (Fase 2) produzira CSVs/JSONs com mesmos valores que o
 * pos-processamento `.py` (Fase 1) ja consome.
 *
 * Execucao:
 *   node --test scripts/tests/test_lib_mjs.test.mjs
 *   npm run test:lib-mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ARCH_LABEL_REST,
  ARCH_LABEL_WEBSERIAL,
  ARCH_LABEL_WEBSOCKET,
  ARCH_ORDER,
  normalizeArch,
  normalizeModeClients,
} from '../lib_mjs/scenarios.mjs';

import {
  mean,
  numericStats,
  parseBool,
  parseInteger,
  percent,
  percentileLinear,
  percentileNearestRank,
  populationStddev,
  round,
  roundStrict,
  sampleStddev,
  summarizeNumericLinear,
  toFloat,
} from '../lib_mjs/stats.mjs';

import {
  appendCsvRows,
  escapeCsv,
  rowsToCsv,
  writeCsvFile,
  writeCsvFromObjects,
} from '../lib_mjs/csv-writer.mjs';

import {
  buildDownloadFilename,
  buildMulticlientFilename,
  buildRepPrefix,
  nowIsoForFile,
  sanitizeFilenamePart,
} from '../lib_mjs/output-naming.mjs';


// -------------------- scenarios --------------------

test('scenarios: ARCH_ORDER e canonico', () => {
  assert.deepEqual(ARCH_ORDER, [ARCH_LABEL_WEBSERIAL, ARCH_LABEL_WEBSOCKET, ARCH_LABEL_REST]);
});

test('scenarios: normalizeArch cobre casos canonicos', () => {
  assert.equal(normalizeArch('webserial', 'webserial'), ARCH_LABEL_WEBSERIAL);
  assert.equal(normalizeArch('backend-node', 'websocket'), ARCH_LABEL_WEBSOCKET);
  assert.equal(normalizeArch('backend-node', 'rest-polling'), ARCH_LABEL_REST);
  assert.equal(normalizeArch('backend-node', 'rest_polling'), ARCH_LABEL_REST);
  assert.equal(normalizeArch('backend-node', 'rest'), ARCH_LABEL_REST);
});

test('scenarios: normalizeArch trim/case-insensitive', () => {
  assert.equal(normalizeArch('  WebSerial ', 'WEBSERIAL'), ARCH_LABEL_WEBSERIAL);
  assert.equal(normalizeArch('backend-node', '  WebSocket  '), ARCH_LABEL_WEBSOCKET);
});

test('scenarios: normalizeArch desconhecido cai no fallback', () => {
  assert.equal(normalizeArch('arch-x', 'mode-y'), 'arch-x/mode-y');
});

test('scenarios: normalizeModeClients (so mode)', () => {
  assert.equal(normalizeModeClients('webserial'), ARCH_LABEL_WEBSERIAL);
  assert.equal(normalizeModeClients('websocket'), ARCH_LABEL_WEBSOCKET);
  assert.equal(normalizeModeClients('rest-polling'), ARCH_LABEL_REST);
  assert.equal(normalizeModeClients('foo'), 'foo');
  assert.equal(normalizeModeClients(null), null);
});

test('scenarios: paridade com lib_py.scenarios via subprocess', () => {
  const cases = [
    ['webserial', 'webserial'],
    ['backend-node', 'websocket'],
    ['backend-node', 'rest-polling'],
    ['backend-node', 'rest_polling'],
    ['backend-node', 'rest'],
    ['WebSerial', 'webserial'],
    ['BACKEND-NODE', 'WEBSOCKET'],
    ['arch-x', 'mode-y'],
  ];
  const py = spawnSync('python', ['-c', `
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from lib_py.scenarios import normalize_arch, normalize_mode_clients
cases = json.loads(sys.argv[1])
out = []
for a, m in cases:
    out.append({'arch': normalize_arch(a, m), 'mode': normalize_mode_clients(m)})
print(json.dumps(out))
`, JSON.stringify(cases)], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const pyResults = JSON.parse(py.stdout);
  for (let i = 0; i < cases.length; i++) {
    const [a, m] = cases[i];
    assert.equal(normalizeArch(a, m), pyResults[i].arch,
      `normalizeArch divergiu de Python em (${a}, ${m})`);
    assert.equal(normalizeModeClients(m), pyResults[i].mode,
      `normalizeModeClients divergiu de Python em (${m})`);
  }
});


// -------------------- stats --------------------

test('stats: toFloat e parseInteger tolerantes', () => {
  assert.equal(toFloat('1.5'), 1.5);
  assert.ok(Number.isNaN(toFloat('')));
  assert.ok(Number.isNaN(toFloat(null)));
  assert.equal(parseInteger('42'), 42);
  assert.equal(parseInteger(''), null);
});

test('stats: parseBool cobre string/number/bool', () => {
  assert.equal(parseBool('True'), true);
  assert.equal(parseBool('true'), true);
  assert.equal(parseBool('1'), true);
  assert.equal(parseBool('yes'), true);
  assert.equal(parseBool('YES'), true);
  assert.equal(parseBool(true), true);
  assert.equal(parseBool(1), true);
  assert.equal(parseBool('false'), false);
  assert.equal(parseBool('0'), false);
  assert.equal(parseBool(0), false);
  assert.equal(parseBool(null), false);
});

test('stats: mean / sample vs population stddev', () => {
  const arr = [1, 2, 3, 4, 5];
  assert.equal(mean(arr), 3);
  // sample (n-1): var = (4+1+0+1+4)/4 = 2.5 -> std = sqrt(2.5) = 1.5811...
  assert.ok(Math.abs(sampleStddev(arr) - Math.sqrt(2.5)) < 1e-12);
  // population (n): var = 2 -> std = sqrt(2) = 1.4142...
  assert.ok(Math.abs(populationStddev(arr) - Math.sqrt(2)) < 1e-12);
});

test('stats: percentileNearestRank igual ao lib_py.percentile (NIST)', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentileNearestRank(arr, 0.95), 95,
    'P95(1..100) nearest-rank deve ser 95, nao 95.05');
  assert.equal(percentileNearestRank(arr, 0.5), 50);
  assert.equal(percentileNearestRank(arr, 0.99), 99);
  assert.equal(percentileNearestRank(arr, 1.0), 100);
  assert.equal(percentileNearestRank(arr, 0.0), 1);
});

test('stats: percentileLinear igual ao numpy.quantile/d3.quantile', () => {
  const arr = Array.from({ length: 100 }, (_, i) => i + 1);
  // numpy.quantile([1..100], 0.95) == 95.05
  assert.ok(Math.abs(percentileLinear(arr, 0.95) - 95.05) < 1e-9);
  assert.ok(Math.abs(percentileLinear(arr, 0.5) - 50.5) < 1e-9);
});

test('stats: round e percent', () => {
  assert.equal(round(1.23456789, 3), 1.235);
  assert.equal(round(null), null);
  assert.equal(round(Infinity), null);
  assert.equal(round('not a number'), null);
  assert.equal(percent(95, 100), 95);
  assert.equal(percent(0, 0), 0);
  assert.equal(roundStrict(1.23456789, 3), 1.235);
});

test('stats: numericStats compativel com lib/scientific.mjs', () => {
  const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const s = numericStats(arr);
  assert.equal(s.samples, 10);
  assert.equal(s.average, 55);
  assert.equal(s.min, 10);
  assert.equal(s.max, 100);
  // p95 (nearest-rank): ceil(10*0.95)-1 = 9 -> arr[9] = 100
  assert.equal(s.p95, 100);
});

test('stats: summarizeNumericLinear compativel com run-multiclient', () => {
  const arr = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const s = summarizeNumericLinear(arr);
  assert.equal(s.samples, 10);
  // linear p95: pos = 9*0.95 = 8.55 -> 90 + 0.55*(100-90) = 95.5
  assert.ok(Math.abs(s.p95 - 95.5) < 1e-9);
});

test('stats: paridade percentile com lib_py.stats', () => {
  // lib_py.percentile aceita p em porcentagem (0-100) e exige vetor ja ordenado.
  const py = spawnSync('python', ['-c', `
import json, sys, pathlib
sys.path.insert(0, str(pathlib.Path('scripts').resolve()))
from lib_py.stats import percentile, mean, sample_stddev, population_stddev
arr = list(range(1, 101))
print(json.dumps({
  'p50': percentile(arr, 50),
  'p95': percentile(arr, 95),
  'p99': percentile(arr, 99),
  'mean': mean(arr),
  'sample_std': sample_stddev(arr),
  'pop_std': population_stddev(arr),
}))
`], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const pyResults = JSON.parse(py.stdout);
  const arr = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentileNearestRank(arr, 0.5), pyResults.p50);
  assert.equal(percentileNearestRank(arr, 0.95), pyResults.p95);
  assert.equal(percentileNearestRank(arr, 0.99), pyResults.p99);
  assert.ok(Math.abs(mean(arr) - pyResults.mean) < 1e-9);
  assert.ok(Math.abs(sampleStddev(arr) - pyResults.sample_std) < 1e-9);
  assert.ok(Math.abs(populationStddev(arr) - pyResults.pop_std) < 1e-9);
});


// -------------------- csv-writer --------------------

test('csv-writer: escapeCsv RFC 4180', () => {
  assert.equal(escapeCsv('abc'), 'abc');
  assert.equal(escapeCsv('a,b'), '"a,b"');
  assert.equal(escapeCsv('a\nb'), '"a\nb"');
  assert.equal(escapeCsv('a"b'), '"a""b"');
  assert.equal(escapeCsv(null), '');
  assert.equal(escapeCsv(undefined), '');
  assert.equal(escapeCsv(123), '123');
});

test('csv-writer: rowsToCsv sem trailing newline', () => {
  const out = rowsToCsv([['a', 'b'], [1, 2]]);
  assert.equal(out, 'a,b\n1,2');
});

test('csv-writer: writeCsvFile usa LF e adiciona trailing newline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'libmjs-'));
  try {
    const out = join(dir, 'test.csv');
    await writeCsvFile(out, ['a', 'b'], [[1, 2], [3, 4]]);
    const bytes = readFileSync(out);
    const text = bytes.toString('utf8');
    assert.equal(text, 'a,b\n1,2\n3,4\n');
    assert.ok(!bytes.includes(0x0d), 'CSV nao pode conter CR (\\r) em nenhum byte');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('csv-writer: writeCsvFromObjects deduz header preservando ordem', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'libmjs-'));
  try {
    const out = join(dir, 'objs.csv');
    await writeCsvFromObjects(out, [
      { interval_ms: 100, rep: 1, latency: 5.0 },
      { interval_ms: 50, rep: 1, latency: 4.5 },
    ]);
    const text = readFileSync(out, 'utf8');
    assert.equal(text, 'interval_ms,rep,latency\n100,1,5\n50,1,4.5\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


// -------------------- output-naming --------------------

test('output-naming: sanitizeFilenamePart', () => {
  assert.equal(sanitizeFilenamePart('saturation refinement'), 'saturation-refinement');
  assert.equal(sanitizeFilenamePart('foo/bar:baz'), 'foo-bar-baz');
  assert.equal(sanitizeFilenamePart('already-ok'), 'already-ok');
});

test('output-naming: nowIsoForFile formato esperado pelo scalability_metrics.py', () => {
  const ts = nowIsoForFile();
  // regex extraido de scalability_metrics.py:60
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z$/.test(ts),
    `formato ${ts} nao bate com regex de scalability_metrics.py`);
});

test('output-naming: buildDownloadFilename casos canonicos', () => {
  const exp = {
    architecture: 'backend-node',
    communicationMode: 'rest-polling',
    source: 'serial',
    sendIntervalMs: 100,
  };
  const fname = buildDownloadFilename(exp, 'sensor-data', 'csv', 2,
    { timestamp: '2026-05-30T05-39-41-619Z', campaignType: 'official' });
  assert.equal(fname, 'backend-node_rest-polling_serial_100ms_rep2_2026-05-30T05-39-41-619Z_sensor-data.csv');
});

test('output-naming: buildDownloadFilename injeta campaignType nao-official', () => {
  const exp = { architecture: 'backend-node', communicationMode: 'websocket', source: 'serial', sendIntervalMs: 1000 };
  const fname = buildDownloadFilename(exp, 'metrics', 'csv', 1,
    { timestamp: '2026-05-30T05-39-41-620Z', campaignType: 'saturation-refinement' });
  assert.equal(fname,
    'backend-node_websocket_serial_1000ms_rep1_2026-05-30T05-39-41-620Z_saturation-refinement_metrics.csv');
});

test('output-naming: buildRepPrefix bate com runtime-utils', () => {
  const prefix = buildRepPrefix({
    architecture: 'backend-node',
    communicationMode: 'websocket',
    source: 'serial',
    lastIntervalMs: 100,
    rep: 1,
  });
  assert.equal(prefix, 'backend-node_websocket_serial_100ms_rep1_');
});

test('output-naming: buildMulticlientFilename', () => {
  const fname = buildMulticlientFilename(
    { mode: 'websocket', intervalMs: 100, clientCount: 5, replicationNumber: 1 },
    'aggregate', 'json',
    { timestamp: '2026-05-30T05-39-41-619Z' });
  assert.equal(fname, 'websocket_100ms_5clients_rep1_2026-05-30T05-39-41-619Z_aggregate.json');
});
