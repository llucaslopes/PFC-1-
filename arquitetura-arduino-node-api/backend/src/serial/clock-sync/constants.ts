// Constantes do protocolo SYNC/SYNC_REPLY do Arduino.
//
// SYNC_TIMEOUT_MS:        max espera por SYNC_REPLY.
// SYNC_INTER_ATTEMPT_MS:  intervalo entre tentativas consecutivas.
// SYNC_SAFE_INTERVAL_MS:  intervalo idle aplicado ANTES do SYNC,
//                         para o TX serial nao estar saturado.
// SYNC_DRAIN_MS:          pausa apos aplicar o intervalo idle, para o
//                         buffer da serial drenar.
// SYNC_ID_LIMIT:          limite superior do `syncId` (Arduino usa
//                         `String.toInt()` -> long signed 32-bit;
//                         reciclamos antes de chegar perto disso).

export const SYNC_TIMEOUT_MS = 2000;
export const SYNC_INTER_ATTEMPT_MS = 50;
export const SYNC_SAFE_INTERVAL_MS = 100;
export const SYNC_DRAIN_MS = 250;
export const SYNC_ID_LIMIT = 1_000_000_000;
