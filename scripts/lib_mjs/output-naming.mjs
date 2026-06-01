
/**
 * Geracao de nomes canonicos para arquivos de coleta.
 *
 * Padrao historico do projeto:
 *   `<arch>_<mode>_<source>_<intervalMs>ms_rep<N>_<isoTimestamp>[_<campaignType>]_<kind>.<ext>`
 *
 * Espelha `lib/scientific.mjs:createDownloadFilename` e o helper inline em
 * `run-multiclient-scalability.mjs` (que monta nomes ligeiramente diferentes
 * mas com a mesma estrutura).
 *
 * Mantem `sanitizeFilenamePart` consistente com `runtime-utils.mjs` (mesma
 * regex `/[^a-zA-Z0-9-]+/g`).
 */

/** Substitui qualquer caracter nao-alfanumerico-nao-`-` por `-`. */
export function sanitizeFilenamePart(value) {
  return String(value).replace(/[^a-zA-Z0-9-]+/g, '-');
}

/**
 * Timestamp ISO 8601 com `:` e `.` substituidos por `-`, formato usado em
 * nomes de arquivo desde o inicio do projeto. NAO trocar por epoch ou outro
 * formato: o regex `_rep\d+_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d+Z)_`
 * em `scalability_metrics.py:60` depende deste formato.
 */
export function nowIsoForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Constroi nome canonico de arquivo de coleta. Espelha
 * `lib/scientific.mjs:createDownloadFilename` byte-a-byte (mesmo separador
 * `_`, mesma ordem de componentes).
 *
 * `kind` exemplos:
 *   - 'sensor-data'         -> `<base>_sensor-data.csv`
 *   - 'metrics'             -> `<base>_metrics.csv`
 *   - 'campaign-summary'    -> `<base>_campaign-summary.csv`
 *   - 'experiment-summary'  -> `<base>_experiment-summary.json`
 *   - 'scalability-summary' -> `<base>_scalability-summary.{csv,json}`
 *
 * Quando `campaignType !== 'official'`, e injetado como ultimo segmento
 * antes do `kind` (mesma logica do original).
 */
export function buildDownloadFilename(experiment, kind, extension,
                                       replicationNumber = 1,
                                       { campaignType = null, timestamp = null } = {}) {
  const ts = timestamp ?? nowIsoForFile();
  const interval = experiment?.sendIntervalMs ?? experiment?.intervalMs ?? 'campaign';
  const type = campaignType ?? experiment?.campaignType ?? null;
  const typePart = type && type !== 'official' ? [sanitizeFilenamePart(type)] : [];
  return [
    experiment?.architecture ?? 'unknown',
    experiment?.communicationMode ?? 'unknown',
    experiment?.source ?? 'unknown',
    `${interval}ms`,
    `rep${replicationNumber}`,
    ts,
    ...typePart,
    kind,
  ].join('_') + `.${extension}`;
}

/**
 * Versao para arquivos de campanha multi-cliente, que tem `clientCount` no
 * meio. Usado por `run-multiclient-scalability.mjs`. Formato:
 *   `<mode>_<intervalMs>ms_<clientCount>clients_rep<N>_<timestamp>_<kind>.<ext>`
 */
export function buildMulticlientFilename({ mode, intervalMs, clientCount, replicationNumber },
                                          kind, extension, { timestamp = null } = {}) {
  const ts = timestamp ?? nowIsoForFile();
  return [
    sanitizeFilenamePart(mode ?? 'unknown'),
    `${intervalMs ?? 0}ms`,
    `${clientCount ?? 1}clients`,
    `rep${replicationNumber ?? 1}`,
    ts,
    kind,
  ].join('_') + `.${extension}`;
}

/**
 * Prefixo para descobrir arquivos ja gerados de uma rep. Espelha
 * `runtime-utils.mjs:isRepComplete` (linha 58).
 */
export function buildRepPrefix({ architecture, communicationMode, source,
                                  lastIntervalMs, rep }) {
  return `${architecture}_${communicationMode}_${source}_${lastIntervalMs}ms_rep${rep}_`;
}
