
/**
 * Testes que protegem o baseline dos frontends (Fase 3).
 *
 * Verifica:
 *   1. O `manifest.json` casa com o estado atual dos JS — qualquer mudanca
 *      precisa ser intencional (regenerar via `snapshot_frontend_baseline.mjs`).
 *   2. O `api-inventory.json` cobre todas as funcoes/classes top-level
 *      atualmente exportadas — impede que uma refatoracao acidentalmente
 *      remova exports publicos consumidos pelas paginas HTML.
 *   3. Os 3 pares de duplicatas conhecidas (clockSyncMath, scientific,
 *      clockSync) ainda existem nos DOIS frontends — qualquer remocao
 *      precoce de uma copia antes de sub-fases 3.1/3.2 derrubaria a HTML
 *      correspondente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const BASELINE_DIR = join(__dirname, 'baselines-frontend');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

test('frontend: manifest sha256 casa com arquivos atuais', () => {
  const manifestPath = join(BASELINE_DIR, 'manifest.json');
  assert.ok(existsSync(manifestPath),
    'baseline ausente; rode `node scripts/tests/snapshot_frontend_baseline.mjs`');
  const manifest = loadJson(manifestPath);
  for (const [rel, info] of Object.entries(manifest.files)) {
    const abs = join(REPO_ROOT, rel);
    assert.ok(existsSync(abs), `arquivo do baseline ausente: ${rel}`);
    const actual = sha256(abs);
    assert.equal(actual, info.sha256,
      `SHA256 divergente em ${rel}: esperado ${info.sha256.slice(0, 12)}, atual ${actual.slice(0, 12)}. Se foi intencional, regenere o baseline.`);
  }
});

test('frontend: inventario de exports cobre todos os arquivos', () => {
  const inv = loadJson(join(BASELINE_DIR, 'api-inventory.json'));
  const manifest = loadJson(join(BASELINE_DIR, 'manifest.json'));
  const manifestKeys = new Set(Object.keys(manifest.files));
  const inventoryKeys = new Set(Object.keys(inv.files));
  for (const k of manifestKeys) {
    assert.ok(inventoryKeys.has(k), `inventario ausente para ${k}`);
  }
  for (const k of inventoryKeys) {
    assert.ok(manifestKeys.has(k), `inventario extra para ${k}`);
  }
});

test('frontend: 3 pares de duplicatas conhecidas estao em ambos os frontends', () => {
  const pairs = [
    ['prototypes/webserial/js/clockSyncMath.js',
     'arquitetura-arduino-node-api/backend/public/js/clockSyncMath.js'],
    ['prototypes/webserial/js/scientific.js',
     'arquitetura-arduino-node-api/backend/public/js/scientific.js'],
    ['prototypes/webserial/js/clockSync.js',
     'arquitetura-arduino-node-api/backend/public/js/clockSync.js'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(existsSync(join(REPO_ROOT, a)),
      `duplicata esperada nao existe: ${a}`);
    assert.ok(existsSync(join(REPO_ROOT, b)),
      `duplicata esperada nao existe: ${b}`);
  }
});

test('frontend: duplicates-diff documenta os 3 pares', () => {
  const diff = readFileSync(join(BASELINE_DIR, 'duplicates-diff.txt'), 'utf8');
  const occurrences = (diff.match(/^PAR DUPLICADO:/gm) || []).length;
  assert.equal(occurrences, 3,
    `esperava 3 pares documentados em duplicates-diff.txt, achou ${occurrences}`);
});

test('frontend: tamanhos catalogados batem com filesystem', () => {
  const manifest = loadJson(join(BASELINE_DIR, 'manifest.json'));
  for (const [rel, info] of Object.entries(manifest.files)) {
    const sizeNow = statSync(join(REPO_ROOT, rel)).size;
    assert.equal(sizeNow, info.size,
      `tamanho divergente em ${rel}: esperado ${info.size}, atual ${sizeNow}`);
  }
});
