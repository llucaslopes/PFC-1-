
/**
 * Escrita CSV consistente para os orquestradores .mjs.
 *
 * Centraliza:
 *
 * - `escapeCsv(value)` conforme RFC 4180 (quote duplo quando contem `",\n`).
 * - `rowsToCsv(rows)` para arrays de arrays (sem trailing newline).
 * - `writeCsvFile(path, header, rows, opts)` que sempre usa LF para garantir
 *   paridade cross-platform (igual ao que fizemos em `scalability_metrics.py`
 *   na Fase 1.3).
 *
 * Extrai duplicacao identificada em `run-multiclient-scalability.mjs:211-219`
 * e `run-scalability-campaign.mjs` (writeCampaignFiles).
 */

import { promises as fsp } from 'node:fs';
import { dirname } from 'node:path';

const NEWLINE = '\n';

export function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(',')).join(NEWLINE);
}

/**
 * Escreve um CSV com header + rows + trailing newline. Forca LF para evitar
 * CRLF em Windows (mesma decisao que `scalability_metrics.py:_write_json_lf`).
 *
 * @param {string} filePath caminho absoluto
 * @param {string[]} header colunas
 * @param {Array<Array<*>>} rows linhas (cada uma alinhada ao header)
 */
export async function writeCsvFile(filePath, header, rows) {
  await fsp.mkdir(dirname(filePath), { recursive: true });
  const headerLine = header.map(escapeCsv).join(',');
  const body = rows.length ? NEWLINE + rowsToCsv(rows) : '';
  await fsp.writeFile(filePath, headerLine + body + NEWLINE, 'utf8');
}

/**
 * Variante para append linha-a-linha (caso o caller queira streamar).
 * Cuidado: nao gera header sozinho; caller deve garantir que o header ja
 * foi escrito (ou usar `writeCsvFile` + `appendCsvRows`).
 */
export async function appendCsvRows(filePath, rows) {
  if (!rows.length) return;
  await fsp.appendFile(filePath, rowsToCsv(rows) + NEWLINE, 'utf8');
}

/**
 * Escreve um CSV a partir de array de objetos. Header e deduzido da uniao
 * das chaves; preserva ordem de insercao da primeira ocorrencia (igual ao
 * `csv.DictWriter` do Python com `fieldnames` ordenado).
 */
export async function writeCsvFromObjects(filePath, objects, { header } = {}) {
  if (!header) {
    const fieldset = new Set();
    for (const obj of objects) {
      for (const key of Object.keys(obj)) fieldset.add(key);
    }
    header = [...fieldset];
  }
  const rows = objects.map((obj) => header.map((col) => obj[col] ?? ''));
  await writeCsvFile(filePath, header, rows);
}
