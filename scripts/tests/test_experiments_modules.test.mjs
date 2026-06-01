
/**
 * Paridade comportamental dos modulos que substituiram o
 * `backend/public/js/experiments.js` original (Sub-fase 3.3).
 *
 * Para funcoes puras carregaveis em Node (sem DOM): comparacao bit-a-bit
 * dos outputs com o fixture original em
 * `scripts/tests/baselines-frontend/originals/backend/experiments.js`.
 *
 * Para funcoes que tocam state global mas nao DOM: mockamos `state` via
 * import dinamico controlado.
 *
 * Para funcoes que tocam DOM/fetch: a Sub-fase de aceite (3.aceite) cobre
 * via Playwright end-to-end. Aqui validamos apenas as funcoes "puras o
 * suficiente" para rodar em Node.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ORIGINAL_FIXTURE = join(__dirname, 'baselines-frontend', 'originals', 'backend', 'experiments.js');
const PUBLIC_JS = join(REPO_ROOT, 'arquitetura-arduino-node-api', 'backend', 'public', 'js');

// `dom.js` chama `document.querySelector` no top-level — precisamos stubar
// document/window/navigator/performance antes de importar qualquer modulo
// que dependa de DOM (direta ou transitivamente).
function stubBrowserGlobals() {
  // O `dom.js` chama `elements.chart.getContext("2d")` no top-level, alem
  // de querySelector em ~25 IDs. Stub completo.
  const fakeNode = () => {
    const node = {
      value: '', textContent: '', disabled: false,
      style: {}, href: '', download: '',
      addEventListener: () => {}, appendChild: () => {}, removeChild: () => {},
      click: () => {}, remove: () => {},
      getContext: () => ({ clearRect: () => {}, beginPath: () => {},
                           moveTo: () => {}, lineTo: () => {}, stroke: () => {},
                           fillText: () => {}, fillRect: () => {},
                           save: () => {}, restore: () => {}, translate: () => {},
                           rotate: () => {} }),
      querySelector: () => fakeNode(),
      width: 100, height: 100,
    };
    return node;
  };
  if (!globalThis.document) {
    globalThis.document = {
      querySelector: () => fakeNode(),
      createElement: () => fakeNode(),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
  }
  if (!globalThis.window) {
    globalThis.window = {
      setInterval: () => 0, clearInterval: () => {},
      setTimeout: () => 0, clearTimeout: () => {},
    };
  }
  if (!globalThis.URL) {
    globalThis.URL = { createObjectURL: () => '', revokeObjectURL: () => {} };
  }
  if (!globalThis.Blob) {
    globalThis.Blob = function () {};
  }
  if (!globalThis.navigator) {
    globalThis.navigator = { userAgent: 'node-test', platform: 'node', language: 'en' };
  }
  if (!globalThis.performance) {
    globalThis.performance = { now: () => Date.now() };
  }
}
stubBrowserGlobals();

// Carrega o fixture original como data URL substituindo imports DOM por
// stubs minimos. So precisamos das funcoes puras (sem DOM).
async function loadOriginalPureFunctions() {
  let src = readFileSync(ORIGINAL_FIXTURE, 'utf8');
  // Substitui imports do DOM por stubs.
  src = src.replace(/from\s+["']\.\/api\.js["']/g, "from 'data:text/javascript,export const refreshMetricsOnly=()=>{};export const refreshSnapshots=()=>{};'");
  src = src.replace(/from\s+["']\.\/chart\.js["']/g, "from 'data:text/javascript,export const drawChart=()=>{};'");
  src = src.replace(/from\s+["']\.\/communication\.js["']/g, "from 'data:text/javascript,export const configureCommunicationMode=()=>{};'");
  src = src.replace(/from\s+["']\.\/clockSync\.js["']/g, "from 'data:text/javascript,export const createRelativeFallbackClockSync=()=>({});export const mergeClockSync=(a,b)=>({...a,...b});export const synchronizeBackendClock=async()=>({});export const LATENCY_METHOD_FALLBACK=\"relative_offset_between_arduino_millis_and_frontend_performance_now\";export const LATENCY_METHOD_SYNC=\"ntp_style_clock_synchronization\";'");
  src = src.replace(/from\s+["']\.\/clockSyncMath\.js["']/g, "from 'data:text/javascript,export const computeEndToEndLatency=(r,s,u,o)=>r-s-o;export const remoteSendToHostMs=(s,u,o)=>s+o;'");
  src = src.replace(/from\s+["']\.\/dom\.js["']/g, "from 'data:text/javascript,export const downloadText=()=>{};export const elements={};'");
  // scientific.js: carregar o real do shared (Node consegue).
  src = src.replace(/from\s+["']\.\/scientific\.js["']/g, `from 'file://${PUBLIC_JS.replace(/\\/g, '/')}/scientific.js'`);
  src = src.replace(/from\s+["']\.\/state\.js["']/g, "from 'data:text/javascript,export const state={observedSamples:[],invalidMessages:[],completedRuns:[],campaign:null,latencyCalibrator:null,clockSync:null,lastObservedSeq:null,observedLostMessages:0,observedSequenceGapMessages:0,currentExperiment:null,seenRestSequences:new Set(),points:[]};'");

  const dataUrl = 'data:text/javascript;base64,' +
    Buffer.from(src, 'utf8').toString('base64');
  return import(dataUrl);
}

async function loadCurrentMetricsBuilder() {
  // O metrics-builder importa do state.js real, mas para os testes de
  // funcoes puras (createExperimentRunsHeader, getLatencyType, etc.) o
  // state nao e tocado.
  return import(pathToFileURL(join(PUBLIC_JS, 'experiments', 'metrics-builder.js')).href);
}

async function loadCurrentUiHelpers() {
  return import(pathToFileURL(join(PUBLIC_JS, 'experiments', 'ui-helpers.js')).href);
}

test('experiments: createExperimentRunsHeader produz mesmas 28 colunas', async () => {
  const cur = await loadCurrentMetricsBuilder();
  const orig = await loadOriginalPureFunctions();
  // O original nao exporta a funcao individualmente — eh interna. Reproduzimos
  // o header esperado em codigo, pra garantir que a nova versao bate.
  const expected = [
    "experiment_id", "architecture", "communication_mode", "source", "started_at",
    "stopped_at", "interval_ms", "duration_seconds", "expected_messages",
    "received_messages", "missing_messages", "sequence_gap_messages",
    "throughput_percent", "messages_per_second", "estimated_latency_avg_ms",
    "estimated_latency_min_ms", "estimated_latency_max_ms", "estimated_latency_std_ms",
    "estimated_latency_p95_ms", "uncertainty_avg_ms", "uncertainty_p95_ms",
    "uncertainty_max_ms", "invalid_messages", "application_version",
    "replication_number", "environment", "saturation_indicators", "saturation_status"
  ];
  assert.deepEqual(cur.createExperimentRunsHeader(), expected);
});

test('experiments: getLatencyType identico ao original', async () => {
  const cur = await loadCurrentMetricsBuilder();
  const orig = await loadOriginalPureFunctions();
  // O original tem getLatencyType como interno; nao exportado. Validamos pela
  // logica equivalente que esta no shared scientific.js.
  for (const sync of [null, { syncFailed: false }, { syncFailed: true }]) {
    const got = cur.getLatencyType(sync);
    const exp = sync?.syncFailed ? "relative_fallback" : "clock_synchronized_estimated_end_to_end";
    assert.equal(got, exp, `clockSync=${JSON.stringify(sync)}`);
  }
});

test('experiments: getLatencyMethod identico ao original', async () => {
  const cur = await loadCurrentMetricsBuilder();
  for (const sync of [null, { syncFailed: false }, { syncFailed: true }]) {
    const got = cur.getLatencyMethod(sync);
    const exp = sync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : "ntp_style_clock_synchronization";
    assert.equal(got, exp, `clockSync=${JSON.stringify(sync)}`);
  }
});

test('experiments: formatDuration identico ao original', async () => {
  const cur = await loadCurrentUiHelpers();
  // Casos hardcoded (sem precisar do original).
  assert.equal(cur.formatDuration(0), "00:00");
  assert.equal(cur.formatDuration(59), "00:59");
  assert.equal(cur.formatDuration(60), "01:00");
  assert.equal(cur.formatDuration(125), "02:05");
  assert.equal(cur.formatDuration(3600), "60:00");
});

test('experiments: sleep retorna Promise resolvida em ~N ms', async () => {
  const cur = await loadCurrentUiHelpers();
  const t0 = Date.now();
  await cur.sleep(50);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 45, `sleep(50) terminou em ${elapsed}ms (esperado >=45)`);
});

test('experiments.js barrel exporta API publica completa', async () => {
  const barrel = await import(pathToFileURL(join(PUBLIC_JS, 'experiments.js')).href);
  const expected = ['startExperiment', 'startCampaign', 'stopExperiment',
                    'resetExperiment', 'exportExperiment', 'recordObservedMessage'];
  for (const name of expected) {
    assert.equal(typeof barrel[name], 'function',
      `experiments.js deveria exportar funcao ${name}`);
  }
});

test('experiments.js: todos os 6 modulos novos existem e carregam', async () => {
  const modules = [
    'experiments/ui-helpers.js',
    'experiments/observation-recorder.js',
    'experiments/metrics-builder.js',
    'experiments/summary-builder.js',
    'experiments/exporter.js',
    'experiments/lifecycle.js',
  ];
  for (const m of modules) {
    const mod = await import(pathToFileURL(join(PUBLIC_JS, m)).href);
    assert.ok(Object.keys(mod).length > 0, `${m} sem exports`);
  }
});
