
/**
 * Reconstrucao heuristica de metricas inter-cliente a partir de per-client.csv.
 *
 * Extraido de `fix-rollover-anomalies.mjs:260-321`. Usado por
 * `correctOneExecution` quando o aggregate.json historico nao tinha
 * unique_messages_across_clients (Problema 3 corrigido em 2026-05).
 *
 * Limitacao auditavel: per-client.csv NAO armazena os seq individuais (so
 * counts agregados). Para REST polling isso impede reconstruir a uniao real
 * e o campo fica `null`. WebSocket e WebSerial tem heuristica conservadora.
 */

import { round } from '../stats.mjs';

export function reconstructInterClientMetrics({ mode, perClientRows, expectedPerClient }) {
  const counts = perClientRows.map((r) => Number(r.messages_received) || 0);
  const totalAll = counts.reduce((a, b) => a + b, 0);
  if (!counts.length) {
    return {
      uniqueMessagesAcrossClients: null,
      uniqueCoveragePercent: null,
      duplicateDeliveriesAcrossClients: null,
      duplicateDeliveryRatio: null,
      reconstructionMethod: 'no_per_client_rows',
    };
  }

  if (mode === 'websocket') {
    // Broadcast => sobreposicao quase total. unique ~= max(count) e expected
    // por cliente ~ unique. Conservador.
    const unique = Math.max(...counts);
    const duplicates = Math.max(0, totalAll - unique);
    return {
      uniqueMessagesAcrossClients: unique,
      uniqueCoveragePercent: expectedPerClient > 0
        ? round((unique / expectedPerClient) * 100)
        : null,
      duplicateDeliveriesAcrossClients: duplicates,
      duplicateDeliveryRatio: totalAll > 0 ? round(duplicates / totalAll, 4) : 0,
      reconstructionMethod: 'websocket_broadcast_max_count',
    };
  }

  if (mode === 'rest-polling') {
    // Sem os seq brutos do historico, deixamos null e marcamos explicitamente.
    // O orquestrador NOVO (run-multiclient-scalability.mjs corrigido) ja
    // produz o Set global em tempo real para campanhas futuras.
    return {
      uniqueMessagesAcrossClients: null,
      uniqueCoveragePercent: null,
      duplicateDeliveriesAcrossClients: null,
      duplicateDeliveryRatio: null,
      reconstructionMethod: 'rest_polling_seq_set_unavailable_in_historic_csv',
    };
  }

  if (mode === 'webserial') {
    // Single client => unique == messagesReceived do unico cliente.
    const unique = counts[0] ?? 0;
    return {
      uniqueMessagesAcrossClients: unique,
      uniqueCoveragePercent: expectedPerClient > 0 ? round((unique / expectedPerClient) * 100) : null,
      duplicateDeliveriesAcrossClients: 0,
      duplicateDeliveryRatio: 0,
      reconstructionMethod: 'webserial_single_client',
    };
  }

  return {
    uniqueMessagesAcrossClients: null,
    uniqueCoveragePercent: null,
    duplicateDeliveriesAcrossClients: null,
    duplicateDeliveryRatio: null,
    reconstructionMethod: 'unknown_mode',
  };
}
