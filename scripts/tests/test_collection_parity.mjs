
/**
 * Suite de paridade dos artefatos de COLETA (Fase 2).
 *
 * Garante que:
 *
 * 1. Schema dos arquivos de coleta (header CSV + chaves JSON) NAO MUDOU em
 *    relacao ao baseline congelado em `baselines-mjs/schema-snapshot.json`.
 *    Este e o contrato externo lido pela Fase 1 (consolidate_results,
 *    scalability_metrics, gera_figuras_tcc, generate-article-charts).
 *
 * 2. SHA256 de todos os artefatos historicos em `resultados/` bate com o
 *    baseline. Garante que o working tree nao acidentalmente regenerou
 *    nenhum CSV/JSON quando refatoramos os orquestradores.
 *
 * 3. Fixtures de replay sao validas e parseiveis (ground truth para os
 *    testes E2E das sub-fases que refatoram cada script).
 *
 * Execucao:
 *   node --test scripts/tests/test_collection_parity.mjs
 *   npm run test:collection-parity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BASELINE_DIR = join(__dirname, 'baselines-mjs');
const FIXTURES_DIR = join(__dirname, 'replay-fixtures');

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Normaliza CRLF -> LF antes de hashear. Sem isso, baselines gerados no
// Windows (working tree pode estar com CRLF herdado) nao batem com o
// checkout do CI Linux (sempre LF via .gitattributes eol=lf).
function sha256(p) {
  const text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const hash = createHash('sha256');
  hash.update(text, 'utf8');
  return hash.digest('hex');
}

test('baseline-mjs: arquivos de baseline existem', () => {
  assert.ok(existsSync(join(BASELINE_DIR, 'manifest.json')),
    'manifest.json ausente; rode `node scripts/tests/snapshot_collection_baseline.mjs`');
  assert.ok(existsSync(join(BASELINE_DIR, 'schema-snapshot.json')),
    'schema-snapshot.json ausente; rode `node scripts/tests/snapshot_collection_baseline.mjs`');
});

test('baseline-mjs: SHA256 de todos os artefatos historicos bate', () => {
  const manifest = loadJson(join(BASELINE_DIR, 'manifest.json'));
  const drift = [];
  for (const [rel, info] of Object.entries(manifest.files)) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      drift.push(`MISSING: ${rel}`);
      continue;
    }
    const cur = sha256(abs);
    if (cur !== info.sha256) {
      drift.push(`SHA256 DRIFT: ${rel} (esperado ${info.sha256.slice(0,12)}, atual ${cur.slice(0,12)})`);
    }
  }
  assert.equal(drift.length, 0,
    `${drift.length} arquivos de coleta divergiram do baseline:\n  ` + drift.slice(0, 20).join('\n  '));
});

test('schema-snapshot: nenhuma categoria perdeu colunas/chaves', () => {
  const schema = loadJson(join(BASELINE_DIR, 'schema-snapshot.json'));
  // Categorias minimas obrigatorias para o pipeline Fase 1 funcionar.
  const REQUIRED = ['sensor-data', 'metrics', 'campaign-summary',
                    'experiment-summary', 'scalability-summary-csv',
                    'scalability-summary-json'];
  for (const cat of REQUIRED) {
    assert.ok(schema.categories[cat], `categoria ${cat} ausente no schema-snapshot`);
  }
});

test('schema-snapshot: sensor-data tem colunas canonicas', () => {
  const schema = loadJson(join(BASELINE_DIR, 'schema-snapshot.json'));
  const header = schema.categories['sensor-data'].header;
  for (const col of ['experiment_id', 'architecture', 'communication_mode',
                     'interval_ms', 'seq', 'send_us', 'frontend_receive_ms',
                     'end_to_end_latency_ms', 'hr', 'ax', 'ay', 'az']) {
    assert.ok(header.includes(col), `coluna ${col} faltando em sensor-data`);
  }
});

test('schema-snapshot: metrics e campaign-summary tem colunas canonicas', () => {
  const schema = loadJson(join(BASELINE_DIR, 'schema-snapshot.json'));
  for (const cat of ['metrics', 'campaign-summary']) {
    const header = schema.categories[cat].header;
    for (const col of ['experiment_id', 'interval_ms', 'expected_messages',
                       'received_messages', 'missing_messages',
                       'throughput_percent', 'estimated_latency_avg_ms',
                       'estimated_latency_p95_ms', 'replication_number']) {
      assert.ok(header.includes(col), `coluna ${col} faltando em ${cat}`);
    }
  }
});

test('schema-snapshot: experiment-summary tem chaves canonicas', () => {
  const schema = loadJson(join(BASELINE_DIR, 'schema-snapshot.json'));
  const keys = new Set(schema.categories['experiment-summary'].keys);
  // Chaves top-level obrigatorias usadas pelos scripts Python downstream.
  for (const key of ['architecture', 'communicationMode', 'intervalMs',
                     'expectedMessages', 'receivedMessages', 'throughputPercent',
                     'latency.averageMs', 'latency.p95Ms', 'latency.samples',
                     'clockSync.arduinoToBackendOffsetMs', 'campaign.id',
                     'campaign.architecture', 'runs',
                     'runs[].experimentId', 'runs[].intervalMs',
                     'runs[].throughputPercent']) {
    assert.ok(keys.has(key), `chave ${key} ausente em experiment-summary`);
  }
});

test('schema-snapshot: scalability-summary-csv tem colunas canonicas (CSV_FIELDS de scalability_metrics.py)', () => {
  const schema = loadJson(join(BASELINE_DIR, 'schema-snapshot.json'));
  const header = schema.categories['scalability-summary-csv'].header;
  for (const col of ['architecture', 'communication_mode', 'source',
                     'interval_ms', 'repetition', 'expected_messages',
                     'received_messages', 'latency_avg_ms', 'latency_p95_ms']) {
    assert.ok(header.includes(col), `coluna ${col} faltando em scalability-summary-csv`);
  }
});

test('replay-fixtures: arduino-stream-100ms.txt parseavel e monotonico em seq', () => {
  const text = readFileSync(join(FIXTURES_DIR, 'arduino-stream-100ms.txt'), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  assert.equal(lines[0], 'seq,send_us,hr,ax,ay,az');
  const seqs = lines.slice(1).map(l => parseInt(l.split(',')[0], 10));
  for (let i = 1; i < seqs.length; i++) {
    assert.equal(seqs[i], seqs[i-1] + 1, `seq nao monotonico em ${i}`);
  }
  assert.ok(seqs.length >= 10, 'fixture deve ter >= 10 amostras');
});

test('replay-fixtures: arduino-stream-rollover.txt cobre wrap-around do micros()', () => {
  const text = readFileSync(join(FIXTURES_DIR, 'arduino-stream-rollover.txt'), 'utf8');
  const lines = text.trim().split(/\r?\n/);
  const sendUs = lines.slice(1).map(l => parseInt(l.split(',')[1], 10));
  const hasNearMax = sendUs.some(v => v > 4_000_000_000);
  const hasLow = sendUs.some(v => v < 1000);
  assert.ok(hasNearMax, 'fixture rollover deve ter valor proximo a 2^32-1');
  assert.ok(hasLow, 'fixture rollover deve ter valor baixo (pos-wrap)');
});
