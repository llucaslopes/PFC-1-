# Tabela 5 — Pontos de saturação por arquitetura

Critério saudável: throughput ≥ 95% E perdas ≤ 1%. "Menor intervalo saudável" é o intervalo mais agressivo (taxa mais alta de envio) no qual a arquitetura ainda atende a esses dois critérios simultaneamente. "Primeiro stress" é o intervalo imediatamente seguinte (mais agressivo) onde a arquitetura passa a violar pelo menos um critério. Útil para o leitor situar rapidamente onde cada padrão começa a sofrer.

| Arquitetura | Menor intervalo saudável (ms) | Primeiro stress (ms) | Motivos do primeiro stress | Intervalo mais agressivo testado (ms) | Throughput nesse intervalo (%) |
|---|---|---|---|---|---|
| A1 — WebSocket | 1000 | 500 | perdas 2.5% > 1% | 20 | 22.16 ± 0.73 |
| A2 — REST polling | indef. | 1000 | perdas 3.3% > 1% | 20 | 22.00 ± 0.70 |
| A4 — MQTT | 100 | 50 | perdas 1.6% > 1% | 20 | 97.81 ± 0.10 |
