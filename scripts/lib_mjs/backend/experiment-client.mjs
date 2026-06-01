
/**
 * HTTP client minimo para `/experiments/*` exposto pelo backend Node.
 *
 * Extraido literalmente de `lib/backend-runner.mjs:474-504`. Mesmo
 * comportamento (mesmas mensagens de erro, mesmo headers).
 */

export async function startExperiment({ baseUrl, payload }) {
  const response = await fetch(`${baseUrl}/experiments/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST /experiments/start falhou: HTTP ${response.status}`);
  }
  return response.json();
}

export async function stopExperiment(baseUrl) {
  await fetch(`${baseUrl}/experiments/stop`, { method: 'POST' });
}

export async function resetExperiment(baseUrl) {
  await fetch(`${baseUrl}/experiments/reset`, { method: 'POST' });
}

export async function postObservation({ baseUrl, observation }) {
  try {
    await fetch(`${baseUrl}/experiments/observations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(observation),
    });
  } catch (error) {
    console.warn(`[orchestrator] Falha ao postar observacao: ${error.message}`);
  }
}
