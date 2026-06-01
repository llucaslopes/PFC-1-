# Tabela 3 – Resumo da escalabilidade horizontal (produtor a 100 ms)

Media e desvio-padrao das 3 repeticoes por (arquitetura, N clientes) com produtor fixo em 100 ms. WebSerial presente apenas em N=1 (Web Serial API e exclusiva por porta). Fonte: `consolidated_metrics_corrected.csv`.

| Arquitetura | N clientes | Throughput agreg. medio (msg/s) | Throughput agreg. desv (msg/s) | Throughput/cliente medio (msg/s) | Throughput/cliente desv (msg/s) | Latencia media (ms) | Latencia media desv (ms) | Latencia P95 pior cliente (ms) | Latencia P95 desv (ms) | Fairness CV medio | Cobertura unica (%) | Razao duplicacao | N reps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| REST Polling | 1 | 9.139 | 0.010 | 9.139 | 0.010 | 54.424 | 0.556 | 99.623 | 0.315 | 0.000 | – | – | 3 |
| REST Polling | 2 | 18.277 | 0.020 | 9.139 | 0.010 | 54.343 | 0.196 | 99.668 | 0.289 | 0.000 | – | – | 3 |
| REST Polling | 5 | 45.750 | 0.000 | 9.150 | 0.000 | 54.626 | 0.145 | 99.801 | 0.499 | 0.000 | – | – | 3 |
| REST Polling | 10 | 91.500 | 0.000 | 9.150 | 0.000 | 55.044 | 0.227 | 100.620 | 0.584 | 0.000 | – | – | 3 |
| REST Polling | 20 | 182.887 | 0.196 | 9.144 | 0.010 | 55.901 | 0.201 | 102.264 | 0.483 | 0.000 | – | – | 3 |
| WebSerial | 1 | 9.989 | 0.010 | 9.989 | 0.010 | 3.638 | 0.026 | 4.473 | 0.018 | 0.000 | 99.889 | 0.000 | 3 |
| WebSocket | 1 | 10.000 | 0.000 | 10.000 | 0.000 | 4.009 | 0.054 | 4.866 | 0.069 | 0.000 | 100.000 | 0.000 | 3 |
| WebSocket | 2 | 20.000 | 0.000 | 10.000 | 0.000 | 4.001 | 0.031 | 4.857 | 0.017 | 0.000 | 100.000 | 0.500 | 3 |
| WebSocket | 5 | 49.989 | 0.020 | 9.998 | 0.004 | 3.979 | 0.017 | 4.846 | 0.018 | 0.000 | 100.056 | 0.800 | 3 |
| WebSocket | 10 | 100.000 | 0.000 | 10.000 | 0.000 | 4.077 | 0.008 | 5.035 | 0.015 | 0.000 | 100.000 | 0.900 | 3 |
| WebSocket | 20 | 200.000 | 0.000 | 10.000 | 0.000 | 4.257 | 0.075 | 5.293 | 0.098 | 0.000 | 100.000 | 0.950 | 3 |
