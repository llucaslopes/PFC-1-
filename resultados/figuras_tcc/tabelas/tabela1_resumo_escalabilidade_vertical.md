# Tabela 1 – Resumo da escalabilidade vertical

Media e desvio-padrao das 3 repeticoes para cada arquitetura e cada intervalo de envio do produtor. Intervalos menores implicam maior taxa de envio (carga). Fonte: `resultados/escalabilidade-2026-05/consolidated_metrics.csv`.

| Arquitetura | Intervalo (ms) | Throughput medio (%) | Throughput desv (%) | Perdas medio (%) | Perdas desv (%) | Latencia media (ms) | Latencia media desv (ms) | Latencia P95 (ms) | Latencia P95 desv (ms) | N reps |
|---|---|---|---|---|---|---|---|---|---|---|
| REST Polling | 100 | 90.78 | 0.10 | 9.22 | 0.10 | 53.99 | 0.38 | 98.52 | 0.61 | 3 |
| REST Polling | 50 | 79.47 | 0.05 | 20.53 | 0.05 | 29.07 | 0.42 | 51.78 | 0.44 | 3 |
| REST Polling | 20 | 63.61 | 0.04 | 36.39 | 0.04 | 14.23 | 0.15 | 23.19 | 0.17 | 3 |
| REST Polling | 10 | 63.67 | 0.02 | 36.33 | 0.02 | 9.12 | 0.11 | 13.67 | 0.12 | 3 |
| REST Polling | 5 | 31.86 | 0.03 | 68.14 | 0.03 | 6.73 | 0.07 | 9.22 | 0.09 | 3 |
| REST Polling | 4 | 25.48 | 0.03 | 74.52 | 0.03 | 6.26 | 0.10 | 8.30 | 0.11 | 3 |
| REST Polling | 3 | 19.17 | 0.03 | 80.83 | 0.03 | 10.71 | 0.08 | 12.63 | 0.10 | 3 |
| REST Polling | 2 | 12.76 | 0.00 | 87.24 | 0.00 | 10.74 | 0.14 | 12.66 | 0.21 | 3 |
| REST Polling | 1 | 7.01 | 0.01 | 92.99 | 0.01 | 10.59 | 0.11 | 12.62 | 0.15 | 3 |
| WebSerial | 100 | 100.00 | 0.00 | 0.00 | 0.00 | 3.66 | 0.02 | 4.51 | 0.00 | 3 |
| WebSerial | 50 | 100.00 | 0.00 | 0.00 | 0.00 | 3.58 | 0.01 | 4.49 | 0.02 | 3 |
| WebSerial | 20 | 100.00 | 0.00 | 0.00 | 0.00 | 3.59 | 0.03 | 4.38 | 0.04 | 3 |
| WebSerial | 10 | 99.98 | 0.00 | 0.02 | 0.00 | 3.62 | 0.02 | 4.52 | 0.02 | 3 |
| WebSerial | 5 | 99.96 | 0.00 | 0.04 | 0.00 | 3.68 | 0.02 | 4.50 | 0.02 | 3 |
| WebSerial | 4 | 99.95 | 0.00 | 0.05 | 0.00 | 3.72 | 0.01 | 4.52 | 0.01 | 3 |
| WebSerial | 3 | 84.06 | 0.00 | 15.94 | 0.00 | 8.37 | 0.02 | 9.15 | 0.02 | 3 |
| WebSerial | 2 | 56.04 | 0.00 | 43.96 | 0.00 | 8.41 | 0.05 | 9.20 | 0.05 | 3 |
| WebSerial | 1 | 28.02 | 0.00 | 71.98 | 0.00 | 8.38 | 0.05 | 9.17 | 0.04 | 3 |
| WebSocket | 100 | 100.00 | 0.00 | 0.00 | 0.00 | 4.09 | 0.06 | 4.90 | 0.09 | 3 |
| WebSocket | 50 | 100.06 | 0.05 | 0.00 | 0.00 | 4.00 | 0.08 | 4.84 | 0.06 | 3 |
| WebSocket | 20 | 100.01 | 0.02 | 0.00 | 0.00 | 3.95 | 0.15 | 4.75 | 0.16 | 3 |
| WebSocket | 10 | 100.00 | 0.00 | 0.00 | 0.00 | 4.08 | 0.25 | 4.80 | 0.06 | 3 |
| WebSocket | 5 | 99.97 | 0.00 | 0.03 | 0.00 | 4.04 | 0.11 | 4.82 | 0.09 | 3 |
| WebSocket | 4 | 99.96 | 0.00 | 0.04 | 0.00 | 4.04 | 0.10 | 4.84 | 0.07 | 3 |
| WebSocket | 3 | 82.13 | 1.91 | 17.87 | 1.91 | 8.63 | 0.06 | 9.42 | 0.06 | 3 |
| WebSocket | 2 | 54.47 | 1.37 | 45.53 | 1.37 | 8.64 | 0.08 | 9.45 | 0.10 | 3 |
| WebSocket | 1 | 27.17 | 0.73 | 72.83 | 0.73 | 8.63 | 0.06 | 9.44 | 0.06 | 3 |
