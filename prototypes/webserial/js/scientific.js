
/**
 * Wrapper finissimo do frontend WebSerial (prototypes/webserial).
 * Toda a logica vive em `_shared/scientific.js`, sincronizado a partir de
 * `shared/js/scientific.js` via `scripts/sync-shared-frontend.mjs`.
 *
 * Aqui apenas sobrescrevemos `applicationVersion` para preservar o output
 * historico do CSV/JSON deste frontend (era "1.0.0").
 */

import { SCIENTIFIC_CONFIG } from "./_shared/scientific.js";

SCIENTIFIC_CONFIG.applicationVersion = "1.0.0";

export * from "./_shared/scientific.js";
