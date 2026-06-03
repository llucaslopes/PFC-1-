// Mede o cold_start_ms da lambda atual. O modelo: cada container fica
// "morno" enquanto reusa a mesma instancia (modulo carregado uma vez).
// Quando a Vercel sobe um novo container, este modulo eh re-importado;
// `MODULE_INIT_AT_MS` registra esse instante. A primeira request servida
// por essa instancia mede `cold_start_ms = handlerStart - MODULE_INIT_AT_MS`.
// Requests subsequentes na MESMA instancia retornam null (warm).

import { performance } from "node:perf_hooks";

export const MODULE_INIT_AT_MS = performance.now();
let firstHandlerCallReported = false;

export function consumeColdStartMs(handlerStartedAtMs: number): number | null {
  if (firstHandlerCallReported) return null;
  firstHandlerCallReported = true;
  const delta = handlerStartedAtMs - MODULE_INIT_AT_MS;
  return Number(delta.toFixed(3));
}
