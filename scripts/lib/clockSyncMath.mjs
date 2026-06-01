
/**
 * Wrapper Node.js que re-exporta `shared/js/clockSyncMath.js`. Em scripts/
 * nao ha chroot HTTP, entao podemos importar via path relativo direto sem
 * precisar de sync. Source of truth e o arquivo em `shared/js/`.
 */
export * from "../../shared/js/clockSyncMath.js";
