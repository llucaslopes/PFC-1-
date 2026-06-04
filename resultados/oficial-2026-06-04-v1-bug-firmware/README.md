# Campanha oficial v1 (descartada por bug de firmware)

Esta pasta guarda a **primeira tentativa** da campanha oficial Wi-Fi
(2026-06-04). Os dados aqui **não** entram no relatório como evidência
empírica -- ficam versionados apenas como trilha de auditoria do bug
que motivou a v2.

A campanha válida está em [`../oficial-2026-06-04-v2/`](../oficial-2026-06-04-v2/).

## Sintomas observados

- Encerrou em ~50 min em vez das ~5 h esperadas.
- Gerou 9 reps em vez de 54 (3 arquiteturas × 6 intervalos × 3 reps).
- Todos os arquivos saíram marcados com `_20ms_`, embora o
  orquestrador tivesse configurado a matriz `1000, 500, 200, 100, 50,
  20 ms`.
- A3 (serverless) nem aparece -- a falha em A1/A2/A4 abortou o resto.

## Causa raiz

O firmware ESP32 da v1 inicializava `sendIntervalMs` com
`DEFAULT_SEND_INTERVAL_MS` mas **nunca atualizava** esse valor depois.
O orquestrador chamava `POST /config { intervalMs: ... }` antes de cada
intervalo, só que o ESP32 não tinha mecanismo de leitura -- continuava
enviando na frequência inicial. Como o `writeCampaignFiles` da época
agregava todos os intervalos da rep em um único arquivo marcado pelo
**último** intervalo da matriz, sobrou esse subconjunto homogêneo de
"20 ms" que na verdade não corresponde a uma rodada real a 20 ms.

## Correções aplicadas para a v2

1. **Firmware** (`embedded/esp32_sports_sensor_wifi/esp32_sports_sensor_wifi.ino`):
   adicionado `pollIntervalConfig()` que faz `GET <base>/config` a cada
   `CONFIG_POLL_INTERVAL_MS` (2 s) e força um poll imediato logo após
   `switchTransport`, fechando a janela de transição.
2. **Runners** (`scripts/lib/backend-runner.mjs` e
   `scripts/lib/serverless-runner.mjs`): cada `(rep, intervalo)` agora
   gera um conjunto independente de arquivos. Sem a agregação
   silenciosa, qualquer rodada incompleta fica visível no diretório.
3. **Smoke test multi-intervalo** (`npm run experiment:smoke-multi` no
   `package.json`): exercita rapidamente o polling do firmware antes
   de qualquer campanha longa, evitando descobrir o problema só depois
   das horas de execução.

## Como esta pasta deve ser usada

- **Pode** ser citada na seção de Limitações/Discussão como
  documentação metodológica (rigor experimental, não fragilidade).
- **Não** deve ser consolidada nem plotada junto da v2: os scripts de
  análise apontam para a pasta da v2, e qualquer comparação direta
  seria inválida.
