/**
 * Warmup ativo: espera o ESP32 estar enviando amostras frescas no
 * baseUrl alvo ANTES do orquestrador chamar `experiments/start`.
 *
 * Por que existe:
 *   O sketch ESP32 e dual-active. Quando o orquestrador troca de
 *   cenario (ex.: derruba backend Node e sobe broker MQTT + bridge),
 *   o ESP32 leva ~3-10 amostras para detectar a mudanca pelo failover
 *   automatico. Se a coleta comecar imediatamente, essas amostras
 *   "perdidas" durante a transicao apareceriam como `missingMessages`
 *   na rep e contaminariam as estatisticas.
 *
 *   `waitForFreshSamples` pinga o /health (backend Node, bridge MQTT)
 *   ou /api/data/latest (serverless) a cada `pollMs` ms ate que a
 *   ultima amostra recebida seja recente -- sinal de que o ESP32 ja
 *   migrou para esse transporte e esta enviando estavelmente. So
 *   entao o orquestrador inicia a coleta.
 *
 *   Em transicoes "limpas" (mesmo transporte do cenario anterior),
 *   o warmup retorna em poucos ms -- nao adiciona overhead.
 */

import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const DEFAULTS = {
  timeoutMs: 12000,    // ate 12s aguardando a 1a amostra fresca.
  freshnessMs: 2000,   // amostra "fresca" = recebida nos ultimos 2s.
  pollMs: 250,         // intervalo entre tentativas.
};

// Multiplicador aplicado sobre intervalMs para definir o que conta como
// amostra "fresca" naquele cenario. 4x cobre jitter de rede + janela de
// /config do firmware (2s) sem ficar tao apertado que reps de 1000 ms
// achem o stream "antigo" quando ele esta saudavel.
const FRESHNESS_MULTIPLIER = 4;

/**
 * Janela de frescor adequada para um dado intervalo de envio. Garante
 * piso de DEFAULTS.freshnessMs para intervalos pequenos onde a conta
 * `intervalMs * 4` seria mais restritiva que o jitter de chegada.
 *
 * @param {number} intervalMs
 * @returns {number}
 */
export function freshnessFor(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return DEFAULTS.freshnessMs;
  }
  return Math.max(DEFAULTS.freshnessMs, intervalMs * FRESHNESS_MULTIPLIER);
}

/**
 * Polling em GET ${baseUrl}/health para checar serial.lastReceiveAt.
 * Resolve quando o backend / bridge confirma que recebeu uma amostra
 * recente. Retorna {ok, reason, elapsedMs} para o chamador logar.
 */
export async function waitForFreshSamples({
  baseUrl,
  timeoutMs = DEFAULTS.timeoutMs,
  freshnessMs = DEFAULTS.freshnessMs,
  pollMs = DEFAULTS.pollMs,
  label = 'warmup',
} = {}) {
  if (!baseUrl) {
    return { ok: false, reason: 'no_base_url', elapsedMs: 0 };
  }

  const start = performance.now();
  let attempt = 0;

  while (performance.now() - start < timeoutMs) {
    attempt += 1;
    try {
      const response = await fetch(`${baseUrl}/health`, { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        const lastReceiveAt = payload?.serial?.lastReceiveAt;
        if (lastReceiveAt) {
          const ageMs = Date.now() - Date.parse(lastReceiveAt);
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= freshnessMs) {
            const elapsedMs = Math.round(performance.now() - start);
            console.log(
              `[orchestrator] [${label}] ESP32 estavel apos ${elapsedMs}ms (ultima amostra ha ${Math.round(ageMs)}ms; tentativas=${attempt}).`
            );
            return { ok: true, reason: 'fresh', elapsedMs, ageMs };
          }
        }
      }
    } catch {
      // Servico ainda nao subiu. Continuar tentando ate o timeout.
    }
    await sleep(pollMs);
  }

  const elapsedMs = Math.round(performance.now() - start);
  console.warn(
    `[orchestrator] [${label}] timeout apos ${elapsedMs}ms sem amostras frescas em ${baseUrl}/health. Iniciando coleta mesmo assim -- a primeira rep pode ter "missing" alto durante a transicao.`
  );
  return { ok: false, reason: 'timeout', elapsedMs };
}

/**
 * Versao para serverless (Vercel KV). Em vez de /health, consulta
 * /data/latest -- o serverless nao tem o conceito de "intake conectado",
 * mas se ha amostras recentes no KV, significa que o ESP32 esta
 * enviando.
 */
export async function waitForFreshSamplesServerless({
  baseUrl,
  apiKey,
  timeoutMs = DEFAULTS.timeoutMs,
  freshnessMs = DEFAULTS.freshnessMs,
  pollMs = DEFAULTS.pollMs,
  label = 'warmup-serverless',
} = {}) {
  if (!baseUrl) {
    return { ok: false, reason: 'no_base_url', elapsedMs: 0 };
  }

  const start = performance.now();
  let attempt = 0;
  const headers = apiKey ? { 'X-Api-Key': apiKey } : {};

  while (performance.now() - start < timeoutMs) {
    attempt += 1;
    try {
      const response = await fetch(`${baseUrl}/data/latest`, {
        headers,
        cache: 'no-store',
      });
      if (response.ok) {
        const payload = await response.json();
        const receivedAt = payload?.receivedAt ?? payload?.serverReceivedAt;
        if (receivedAt) {
          const ageMs = Date.now() - Date.parse(receivedAt);
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= freshnessMs) {
            const elapsedMs = Math.round(performance.now() - start);
            console.log(
              `[orchestrator] [${label}] serverless estavel apos ${elapsedMs}ms (ultima amostra ha ${Math.round(ageMs)}ms; tentativas=${attempt}).`
            );
            return { ok: true, reason: 'fresh', elapsedMs, ageMs };
          }
        }
      }
    } catch {
      // Continuar tentando.
    }
    await sleep(pollMs);
  }

  const elapsedMs = Math.round(performance.now() - start);
  console.warn(
    `[orchestrator] [${label}] timeout apos ${elapsedMs}ms sem amostras frescas em ${baseUrl}/data/latest.`
  );
  return { ok: false, reason: 'timeout', elapsedMs };
}
