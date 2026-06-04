
/**
 * Normalizacao de arquiteturas C1/C2/C3 e paletas (espelha `lib_py/scenarios.py`).
 *
 * Os orquestradores `.mjs` historicamente classificam arquiteturas via
 * `(architecture, communicationMode)` ou apenas `mode`, com varias copias
 * inline. Este modulo centraliza a logica para ficar 100% consistente com
 * o que a Fase 1 (Python) faz quando le os mesmos CSVs.
 *
 * Garantia bit-a-bit: para qualquer par `(architecture, communicationMode)`
 * conhecido, `normalizeArch` aqui retorna a mesma string que
 * `lib_py.scenarios.normalize_arch`. Teste em `tests/test_lib_mjs.test.mjs`.
 */

// Identificadores A1/A2 sao internos da metodologia (mapeam para as 4
// arquiteturas da campanha) e ainda aparecem como nomes de variavel / CLI,
// mas o VALOR exposto -- usado como rotulo em qualquer figura/tabela
// destinada ao artigo do PFC -- foi simplificado para apenas o nome do
// padrao de comunicacao, espelhando `lib_py/scenarios.py`.
export const ARCH_LABEL_WEBSERIAL = 'WebSerial';
export const ARCH_LABEL_WEBSOCKET = 'WebSocket';
export const ARCH_LABEL_REST = 'REST Polling';

export const ARCH_ORDER = [
  ARCH_LABEL_WEBSERIAL,
  ARCH_LABEL_WEBSOCKET,
  ARCH_LABEL_REST,
];

export const CANONICAL_ARCH_COLORS = {
  [ARCH_LABEL_WEBSERIAL]: '#1f77b4',
  [ARCH_LABEL_WEBSOCKET]: '#2ca02c',
  [ARCH_LABEL_REST]: '#d62728',
};

export const CANONICAL_ARCH_MARKERS = {
  [ARCH_LABEL_WEBSERIAL]: 'o',
  [ARCH_LABEL_WEBSOCKET]: 's',
  [ARCH_LABEL_REST]: '^',
};

export const CANONICAL_ARCH_LINESTYLES = {
  [ARCH_LABEL_WEBSERIAL]: '-',
  [ARCH_LABEL_WEBSOCKET]: '--',
  [ARCH_LABEL_REST]: ':',
};

/**
 * Devolve o rotulo canonico ("WebSerial"/"WebSocket"/"REST Polling") a partir
 * do par `(architecture, communicationMode)` dos CSVs verticais.
 *
 * Para combinacoes desconhecidas retorna `"<arch>/<mode>"`, igual ao
 * comportamento de `lib_py.scenarios.normalize_arch`.
 */
export function normalizeArch(architecture, communicationMode) {
  const arch = String(architecture ?? '').trim().toLowerCase();
  const mode = String(communicationMode ?? '').trim().toLowerCase();
  if (arch === 'webserial' || mode === 'webserial') return ARCH_LABEL_WEBSERIAL;
  if (mode === 'websocket') return ARCH_LABEL_WEBSOCKET;
  if (mode === 'rest-polling' || mode === 'rest_polling' || mode === 'rest') return ARCH_LABEL_REST;
  return `${architecture}/${communicationMode}`;
}

/**
 * Versao usada pela campanha multi-cliente, que so tem a coluna `mode`.
 * Espelha `lib_py.scenarios.normalize_mode_clients` byte-a-byte.
 */
export function normalizeModeClients(mode) {
  const m = String(mode ?? '').trim().toLowerCase();
  if (m === 'webserial') return ARCH_LABEL_WEBSERIAL;
  if (m === 'websocket') return ARCH_LABEL_WEBSOCKET;
  if (m === 'rest-polling' || m === 'rest_polling' || m === 'rest') return ARCH_LABEL_REST;
  return mode;
}
