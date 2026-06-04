# Tabela 2 — Resumo detalhado por arquitetura × intervalo

Média ± desvio padrão das 3 repetições para cada combinação de arquitetura e intervalo de envio do produtor. Intervalos menores implicam taxa maior de envio (carga). Tabela de apoio que alimenta a Figura de throughput e a Figura de latência do artigo.

| Arquitetura | Intervalo (ms) | Throughput (%) | Perdas (%) | Latência média (ms) | Latência P95 (ms) | N reps |
|---|---|---|---|---|---|---|
| A1 — WebSocket | 1000 | 118.33 ± 14.24 | 0.00 ± 0.00 | 41.12 ± 4.08 | 124.03 ± 4.02 | 3 |
| A1 — WebSocket | 500 | 97.50 ± 2.20 | 2.50 ± 2.20 | 51.54 ± 3.39 | 147.57 ± 26.65 | 3 |
| A1 — WebSocket | 200 | 97.89 ± 1.07 | 2.11 ± 1.07 | 43.45 ± 3.06 | 132.26 ± 13.06 | 3 |
| A1 — WebSocket | 100 | 91.06 ± 4.95 | 8.94 ± 4.95 | 31.57 ± 3.76 | 86.49 ± 35.84 | 3 |
| A1 — WebSocket | 50 | 55.08 ± 0.95 | 44.92 ± 0.95 | 32.53 ± 3.78 | 105.22 ± 11.04 | 3 |
| A1 — WebSocket | 20 | 22.16 ± 0.73 | 77.84 ± 0.73 | 33.33 ± 4.54 | 105.70 ± 14.94 | 3 |
| A2 — REST polling | 1000 | 96.67 ± 1.67 | 3.33 ± 1.67 | 553.14 ± 200.61 | 910.32 ± 162.38 | 3 |
| A2 — REST polling | 500 | 95.00 ± 2.89 | 5.00 ± 2.89 | 286.91 ± 11.15 | 507.37 ± 4.84 | 3 |
| A2 — REST polling | 200 | 91.00 ± 1.73 | 9.00 ± 1.73 | 135.32 ± 2.66 | 232.84 ± 14.20 | 3 |
| A2 — REST polling | 100 | 82.11 ± 0.67 | 17.89 ± 0.67 | 83.16 ± 2.12 | 138.19 ± 6.63 | 3 |
| A2 — REST polling | 50 | 54.78 ± 1.09 | 45.22 ± 1.09 | 73.05 ± 1.11 | 146.00 ± 3.73 | 3 |
| A2 — REST polling | 20 | 22.00 ± 0.70 | 78.00 ± 0.70 | 57.72 ± 3.61 | 125.89 ± 9.99 | 3 |
| A4 — MQTT | 1000 | 201.67 ± 6.01 | 0.00 ± 0.00 | 4.51 ± 4.35 | 27.20 ± 27.00 | 3 |
| A4 — MQTT | 500 | 99.17 ± 0.00 | 0.83 ± 0.00 | 0.00 ± 0.00 | 0.00 ± 0.00 | 3 |
| A4 — MQTT | 200 | 99.67 ± 0.00 | 0.33 ± 0.00 | 0.00 ± 0.00 | 0.00 ± 0.00 | 3 |
| A4 — MQTT | 100 | 99.83 ± 0.00 | 0.17 ± 0.00 | 2.81 ± 0.60 | 25.62 ± 4.28 | 3 |
| A4 — MQTT | 50 | 98.36 ± 0.10 | 1.64 ± 0.10 | 13.06 ± 2.56 | 67.55 ± 4.44 | 3 |
| A4 — MQTT | 20 | 97.81 ± 0.10 | 2.19 ± 0.10 | 14.98 ± 1.91 | 69.78 ± 3.88 | 3 |
