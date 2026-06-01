
/**
 * Wrapper finissimo do frontend backend client (arquitetura-arduino-node-api).
 * Toda a logica vive em `_shared/scientific.js`, sincronizado a partir de
 * `shared/js/scientific.js` via `scripts/sync-shared-frontend.mjs`.
 *
 * Aqui apenas sobrescrevemos `applicationVersion` para preservar o output
 * historico do CSV/JSON deste frontend (era "0.1.0").
 */

import { SCIENTIFIC_CONFIG } from "./_shared/scientific.js";

SCIENTIFIC_CONFIG.applicationVersion = "0.1.0";

export * from "./_shared/scientific.js";
