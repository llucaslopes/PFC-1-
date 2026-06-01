
/**
 * Parser CSV minimo (compativel com escapeCsv/rowsToCsv de `csv-writer.mjs`).
 *
 * Extraido de `fix-rollover-anomalies.mjs:142-207`. Suporta:
 *   - Aspas duplas conforme RFC 4180 (escape via "").
 *   - Campos com `,` e `\n` dentro de quotes.
 *   - Line endings CRLF e LF.
 *
 * `csvToObjects` aceita 1a linha como header e devolve `{ header, objects }`,
 * usado pelo orquestrador de correcao para reler arquivos historicos.
 */

export function parseCsv(text) {
  const result = [];
  let current = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      current.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      current.push(field);
      result.push(current);
      current = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    result.push(current);
  }
  return result;
}

export function csvToObjects(text) {
  const rows = parseCsv(text).filter(
    (row) => row.length > 1 || (row.length === 1 && row[0] !== ''));
  if (!rows.length) return { header: [], objects: [] };
  const header = rows[0];
  const objects = rows.slice(1).map((row) => {
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] ?? '';
    }
    return obj;
  });
  return { header, objects };
}
