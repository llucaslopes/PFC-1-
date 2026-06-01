
/**
 * Paridade comportamental: garante que apos a unificacao em `shared/js/scientific.js`,
 * cada um dos 2 wrappers (webserial e backend) continua produzindo OUTPUTS
 * identicos aos modulos originais (preservados como fixtures em
 * `scripts/tests/baselines-frontend/originals/`).
 *
 * Como?
 *   - Carregamos o fixture original via dynamic import (URL `file://`).
 *   - Carregamos o wrapper atual idem.
 *   - Os arquivos do wrapper atual importam `./_shared/scientific.js`,
 *     que e local ao diretorio do wrapper — funciona via file:// porque o
 *     resolver do Node respeita os paths relativos do arquivo importado.
 *   - Comparamos: SCIENTIFIC_CONFIG, numericStats, formatClockSyncExport,
 *     createRawRows, createRunSummary (sem environment, que depende de
 *     navigator), createSummaryRow, createExperimentExportBlock,
 *     environmentToCsv, percent, round.
 *   - createDownloadFilename produz um timestamp dinamico — testamos apenas
 *     a parte estrutural (sem o timestamp).
 *
 * Notas:
 *   - createLatencyCalibrator nao depende de SCIENTIFIC_CONFIG; comparamos
 *     que calculate(...) produz o mesmo numero.
 *   - addSaturationIndicators / createSaturationAnalysis: testamos com um
 *     summary mock.
 *   - collectEnvironment usa `navigator` (so existe no browser); skip.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ORIGINALS = join(__dirname, 'baselines-frontend', 'originals');

const PAIRS = [
  {
    name: 'webserial',
    original: join(ORIGINALS, 'webserial', 'scientific.js'),
    current: join(REPO_ROOT, 'prototypes', 'webserial', 'js', 'scientific.js'),
    expectedAppVersion: '1.0.0',
  },
  {
    name: 'backend',
    original: join(ORIGINALS, 'backend', 'scientific.js'),
    current: join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'public', 'js', 'scientific.js'),
    expectedAppVersion: '0.1.0',
  },
];

async function load(path) {
  return import(pathToFileURL(path).href);
}

// Mock de clockSync cobrindo os campos usados por AMBOS os consumidores.
const MOCK_CLOCK_WEBSERIAL = {
  arduinoToBackendOffsetMs: 12.345,
  arduinoToFrontendOffsetMs: 13.567,
  arduinoToFrontendRttMs: 4.5,
  arduinoToFrontendUncertaintyMs: 2.25,
  syncAttempts: 3,
  selectedBy: 'lowest_rtt',
  syncedAt: '2026-01-01T00:00:00.000Z',
  syncFailed: false,
  fallbackReason: null,
  // Campos historicos do webserial:
  arduinoHostOffsetMs: 11.0,
  arduinoHostRttMs: 5.0,
  arduinoHostUncertaintyMs: 2.5,
};

const MOCK_CLOCK_BACKEND = {
  arduinoToBackendOffsetMs: 8.123,
  arduinoToFrontendOffsetMs: 9.456,
  backendToFrontendOffsetMs: 1.0,
  backendToFrontendRttMs: 2.0,
  frontendBackendOffsetMs: 0.5,
  frontendBackendRttMs: 1.5,
  arduinoToBackendRttMs: 3.0,
  arduinoToFrontendUncertaintyMs: 1.0,
  syncAttempts: 2,
  selectedBy: 'lowest_rtt',
  syncedAt: '2026-01-02T00:00:00.000Z',
  syncFailed: false,
  fallbackReason: null,
};

const SAMPLE_EXPERIMENT = {
  id: 'exp-1',
  architecture: 'webserial',
  communicationMode: 'webserial',
  source: 'serial',
  startedAt: '2026-01-01T00:00:00.000Z',
  stoppedAt: '2026-01-01T00:01:00.000Z',
  durationSeconds: 60,
  sendIntervalMs: 100,
  replicationNumber: 1,
  environmentText: '',
  clockSync: MOCK_CLOCK_WEBSERIAL,
};

const SAMPLE_DATA = [
  { seq: 0, sendUs: 100_000, sendMs: 100, frontendReceiveMs: 105, receiveMs: 105,
    estimatedFrontendSendMs: 100, endToEndLatencyMs: 5,
    clockOffsetMs: 13, clockUncertaintyMs: 2.25, syncRttMs: 4.5,
    latencyMethod: 'ntp_style_clock_synchronization',
    hr: 72, ax: 0.1, ay: -0.2, az: 1.0 },
  { seq: 1, sendUs: 200_000, sendMs: 200, frontendReceiveMs: 207, receiveMs: 207,
    estimatedFrontendSendMs: 200, endToEndLatencyMs: 7,
    clockOffsetMs: 13.1, clockUncertaintyMs: 2.30, syncRttMs: 4.6,
    latencyMethod: 'ntp_style_clock_synchronization',
    hr: 73, ax: 0.0, ay: -0.1, az: 1.01 },
];

function stripFilenameTimestamp(name) {
  // Substitui o timestamp ISO normalizado para `_` (que e estavel) por '__TS__'.
  return name.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_/g, '_TS_');
}

for (const pair of PAIRS) {
  test(`${pair.name}: SCIENTIFIC_CONFIG.applicationVersion preserva versao historica`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    assert.equal(cur.SCIENTIFIC_CONFIG.applicationVersion, pair.expectedAppVersion);
    assert.equal(orig.SCIENTIFIC_CONFIG.applicationVersion, pair.expectedAppVersion);
    // Resto do config bate exatamente.
    for (const key of Object.keys(orig.SCIENTIFIC_CONFIG)) {
      assert.deepEqual(cur.SCIENTIFIC_CONFIG[key], orig.SCIENTIFIC_CONFIG[key], `${key} divergente`);
    }
  });

  test(`${pair.name}: numericStats identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const data = [1, 2, 3, 4, 5, 10, 100, NaN, Infinity, -Infinity, null];
    assert.deepEqual(cur.numericStats(data), orig.numericStats(data));
    assert.deepEqual(cur.numericStats([]), orig.numericStats([]));
    assert.deepEqual(cur.numericStats([42]), orig.numericStats([42]));
  });

  test(`${pair.name}: formatClockSyncExport identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    // Cada consumidor usa SEU mock historico para garantir mesma cadeia de fallback.
    const mock = pair.name === 'webserial' ? MOCK_CLOCK_WEBSERIAL : MOCK_CLOCK_BACKEND;
    assert.deepEqual(cur.formatClockSyncExport(mock), orig.formatClockSyncExport(mock));
    assert.equal(cur.formatClockSyncExport(null), orig.formatClockSyncExport(null));
  });

  test(`${pair.name}: createRawRows identico ao original`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    assert.deepEqual(
      cur.createRawRows(SAMPLE_EXPERIMENT, SAMPLE_DATA),
      orig.createRawRows(SAMPLE_EXPERIMENT, SAMPLE_DATA)
    );
  });

  test(`${pair.name}: createRunSummary + createSummaryRow + createExperimentExportBlock`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const expCur = { ...SAMPLE_EXPERIMENT, clockSync:
      pair.name === 'webserial' ? MOCK_CLOCK_WEBSERIAL : MOCK_CLOCK_BACKEND };
    const summaryCur = cur.createRunSummary({ experiment: expCur, samples: SAMPLE_DATA, invalidMessages: [], sequenceGapMessages: 0 });
    const summaryOrig = orig.createRunSummary({ experiment: expCur, samples: SAMPLE_DATA, invalidMessages: [], sequenceGapMessages: 0 });
    assert.deepEqual(summaryCur, summaryOrig);
    assert.deepEqual(cur.createSummaryRow(summaryCur), orig.createSummaryRow(summaryOrig));
    assert.deepEqual(cur.createExperimentExportBlock(summaryCur), orig.createExperimentExportBlock(summaryOrig));
  });

  test(`${pair.name}: addSaturationIndicators + createSaturationAnalysis`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const summaries = [
      { intervalMs: 100, throughputPercent: 99.5, missingMessages: 0, estimatedLatencyAverageMs: 5, estimatedLatencyP95Ms: 8 },
      { intervalMs: 50, throughputPercent: 98.0, missingMessages: 0, estimatedLatencyAverageMs: 6, estimatedLatencyP95Ms: 9 },
      { intervalMs: 5, throughputPercent: 60.0, missingMessages: 30, estimatedLatencyAverageMs: 20, estimatedLatencyP95Ms: 25 },
    ];
    // addSaturationIndicators muta; clonamos para isolar.
    const sumCur = summaries.map((s) => ({ ...s }));
    const sumOrig = summaries.map((s) => ({ ...s }));
    cur.addSaturationIndicators(sumCur);
    orig.addSaturationIndicators(sumOrig);
    assert.deepEqual(sumCur, sumOrig);

    const sumCur2 = summaries.map((s) => ({ ...s }));
    const sumOrig2 = summaries.map((s) => ({ ...s }));
    assert.deepEqual(cur.createSaturationAnalysis(sumCur2), orig.createSaturationAnalysis(sumOrig2));
  });

  test(`${pair.name}: environmentToCsv + percent + round identicos`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const env = { browser: 'Mozilla;Test', platform: 'Win32', applicationVersion: pair.expectedAppVersion };
    assert.equal(cur.environmentToCsv(env), orig.environmentToCsv(env));
    assert.equal(cur.environmentToCsv(null), orig.environmentToCsv(null));
    for (const [p, t] of [[1, 10], [5, 5], [0, 0], [3, 7]]) {
      assert.equal(cur.percent(p, t), orig.percent(p, t));
    }
    for (const v of [1.23456789, 0.1, 100.5, 0, -3.14159]) {
      assert.equal(cur.round(v), orig.round(v));
      assert.equal(cur.round(v, 5), orig.round(v, 5));
    }
  });

  test(`${pair.name}: createDownloadFilename gera mesma estrutura (timestamp normalizado)`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const exp = { architecture: 'arch', communicationMode: 'mode', source: 'src', sendIntervalMs: 100 };
    const aCur = stripFilenameTimestamp(cur.createDownloadFilename(exp, 'sensor-data', 'csv', 2));
    const aOrig = stripFilenameTimestamp(orig.createDownloadFilename(exp, 'sensor-data', 'csv', 2));
    assert.equal(aCur, aOrig);
    // Backend antigo ignora `options.campaignType` — o novo, ao receber options vazias,
    // tambem ignora; com options={campaignType:'refinement'}, o webserial original ja anexava
    // e o atual continua igual. O backend original ignorava — testamos so se o atual nao quebra.
    if (pair.name === 'webserial') {
      const bCur = stripFilenameTimestamp(cur.createDownloadFilename(exp, 'metrics', 'csv', 1, { campaignType: 'refinement' }));
      const bOrig = stripFilenameTimestamp(orig.createDownloadFilename(exp, 'metrics', 'csv', 1, { campaignType: 'refinement' }));
      assert.equal(bCur, bOrig);
    }
  });

  test(`${pair.name}: createLatencyCalibrator calculate identico`, async () => {
    const cur = await load(pair.current);
    const orig = await load(pair.original);
    const calCur = cur.createLatencyCalibrator();
    const calOrig = orig.createLatencyCalibrator();
    const calls = [[100, 105], [200, 210], [300, 308], [400, 415]];
    for (const [s, r] of calls) {
      assert.equal(calCur.calculate(s, r), calOrig.calculate(s, r));
    }
    assert.deepEqual(calCur.getBaseline(), calOrig.getBaseline());
  });
}

test('sync-shared-frontend: _shared/scientific.js em ambos os destinos casa com source', async () => {
  const sourceUrl = pathToFileURL(join(REPO_ROOT, 'shared', 'js', 'scientific.js')).href;
  const source = await import(sourceUrl);

  for (const target of [
    join(REPO_ROOT, 'prototypes', 'webserial', 'js', '_shared', 'scientific.js'),
    join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'public', 'js', '_shared', 'scientific.js'),
  ]) {
    const copy = await import(pathToFileURL(target).href);
    assert.deepEqual(Object.keys(copy).sort(), Object.keys(source).sort(),
      `exports divergem em ${target}`);
  }
});
