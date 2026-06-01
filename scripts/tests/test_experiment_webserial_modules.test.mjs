
/**
 * Paridade comportamental dos modulos que substituiram o
 * `prototypes/webserial/js/experiment.js` original (Sub-fase 3.4).
 *
 * Mesmo principio do `test_experiments_modules.test.mjs` (backend): testa
 * funcoes puras carregaveis em Node + valida API publica do barrel.
 * Funcoes que tocam DOM/serial/simulator sao cobertas via Playwright na
 * Sub-fase de aceite (3.aceite).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const WEBSERIAL_JS = join(REPO_ROOT, 'prototypes', 'webserial', 'js');

// `dom.js` chama document.getElementById/querySelector no top-level + alguns
// modulos chamam `Blob`, `URL.createObjectURL`, etc. Stub completo.
function stubBrowserGlobals() {
  const fakeNode = () => {
    const node = {
      value: '', textContent: '', disabled: false,
      style: {}, href: '', download: '', dataset: {},
      addEventListener: () => {}, appendChild: () => {}, removeChild: () => {},
      click: () => {}, remove: () => {},
      getContext: () => ({ clearRect: () => {}, beginPath: () => {} }),
      querySelector: () => fakeNode(),
      width: 100, height: 100,
    };
    return node;
  };
  if (!globalThis.document) {
    globalThis.document = {
      querySelector: () => fakeNode(),
      getElementById: () => fakeNode(),
      createElement: () => fakeNode(),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
  }
  if (!globalThis.window) {
    globalThis.window = {
      setInterval: () => 0, clearInterval: () => {},
      setTimeout: () => 0, clearTimeout: () => {},
      __PFC_EXPERIMENT_CAMPAIGN: null,
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

async function loadMetricsBuilder() {
  return import(pathToFileURL(join(WEBSERIAL_JS, 'experiment', 'metrics-builder.js')).href);
}
async function loadUiHelpers() {
  return import(pathToFileURL(join(WEBSERIAL_JS, 'experiment', 'ui-helpers.js')).href);
}

test('webserial: createExperimentRunsHeader produz mesmas 28 colunas', async () => {
  const mb = await loadMetricsBuilder();
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
  assert.deepEqual(mb.createExperimentRunsHeader(), expected);
});

test('webserial: getLatencyType identico ao original', async () => {
  const mb = await loadMetricsBuilder();
  for (const sync of [null, { syncFailed: false }, { syncFailed: true }]) {
    const got = mb.getLatencyType(sync);
    const exp = sync?.syncFailed ? "relative_fallback" : "clock_synchronized_estimated_end_to_end";
    assert.equal(got, exp);
  }
});

test('webserial: getLatencyMethod identico ao original', async () => {
  const mb = await loadMetricsBuilder();
  for (const sync of [null, { syncFailed: false }, { syncFailed: true }]) {
    const got = mb.getLatencyMethod(sync);
    const exp = sync?.syncFailed
      ? "relative_offset_between_arduino_millis_and_frontend_performance_now"
      : "ntp_style_clock_synchronization";
    assert.equal(got, exp);
  }
});

test('webserial: formatDuration identico ao original', async () => {
  const ui = await loadUiHelpers();
  assert.equal(ui.formatDuration(0), "00:00");
  assert.equal(ui.formatDuration(59), "00:59");
  assert.equal(ui.formatDuration(60), "01:00");
  assert.equal(ui.formatDuration(125), "02:05");
  assert.equal(ui.formatDuration(3600), "60:00");
});

test('webserial: readCampaignConfig default = official + stress intervals', async () => {
  const ui = await loadUiHelpers();
  globalThis.window.__PFC_EXPERIMENT_CAMPAIGN = null;
  const cfg = ui.readCampaignConfig();
  assert.equal(cfg.type, 'official');
  assert.ok(Array.isArray(cfg.intervalsMs) && cfg.intervalsMs.length > 0);
});

test('webserial: readCampaignConfig usa overrides quando setado', async () => {
  const ui = await loadUiHelpers();
  globalThis.window.__PFC_EXPERIMENT_CAMPAIGN = {
    type: 'scalability',
    intervalsMs: [100, 50, 10],
  };
  const cfg = ui.readCampaignConfig();
  assert.equal(cfg.type, 'scalability');
  assert.deepEqual(cfg.intervalsMs, [100, 50, 10]);
  globalThis.window.__PFC_EXPERIMENT_CAMPAIGN = null;
});

test('webserial: readCampaignConfig ignora intervalsMs invalidos', async () => {
  const ui = await loadUiHelpers();
  globalThis.window.__PFC_EXPERIMENT_CAMPAIGN = {
    type: 'refinement',
    intervalsMs: [100, -5, 'foo', 50, 0, NaN, 10],
  };
  const cfg = ui.readCampaignConfig();
  assert.equal(cfg.type, 'refinement');
  assert.deepEqual(cfg.intervalsMs, [100, 50, 10]);
  globalThis.window.__PFC_EXPERIMENT_CAMPAIGN = null;
});

test('webserial: experiment.js barrel exporta API publica completa', async () => {
  const barrel = await import(pathToFileURL(join(WEBSERIAL_JS, 'experiment.js')).href);
  const expected = ['startExperiment', 'startCampaign', 'stopExperiment',
                    'stopExperimentTimer', 'exportExperiment',
                    'recordExperimentSample', 'recordExperimentInvalid'];
  for (const name of expected) {
    assert.equal(typeof barrel[name], 'function',
      `experiment.js deveria exportar funcao ${name}`);
  }
});

test('webserial: todos os 6 modulos novos carregam', async () => {
  for (const m of [
    'experiment/ui-helpers.js',
    'experiment/observation-recorder.js',
    'experiment/metrics-builder.js',
    'experiment/summary-builder.js',
    'experiment/exporter.js',
    'experiment/lifecycle.js',
  ]) {
    const mod = await import(pathToFileURL(join(WEBSERIAL_JS, m)).href);
    assert.ok(Object.keys(mod).length > 0, `${m} sem exports`);
  }
});
