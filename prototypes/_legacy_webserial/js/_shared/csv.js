// AUTO-SYNCED FROM shared/js/ — DO NOT EDIT BY HAND.
// Source of truth: shared/js/<file>.js. Re-run `npm run sync:shared`.

/**
 * Helpers de CSV compartilhados entre os 2 frontends. Source of truth para:
 *   - `prototypes/webserial/js/csv.js`        (3 linhas de wrapper)
 *   - `arquitetura-arduino-node-api/backend/public/js/experiments.js` (bloco final)
 *
 * Schema: linhas separadas por LF (sem CR), valores aspeados apenas quando
 * contem virgula, aspas ou newline. Aspas internas duplicadas (RFC 4180).
 */

export function escapeCsv(value) {
  const text = String(value);

  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}
