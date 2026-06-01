# Tabela 2 – Pontos de stress por arquitetura

Criterio saudavel: throughput >= 95%, perdas <= 1%, latencia media e P95 <= 2x baseline (100 ms). 'Menor intervalo saudavel' e o intervalo mais agressivo no qual a arquitetura ainda atende a todos os criterios. 'Primeiro stress' e o intervalo imediatamente seguinte (mais agressivo) onde algum criterio passa a falhar.

| Arquitetura | Intervalo de baseline (ms) | Throughput baseline (%) | Perdas baseline (%) | Latencia avg baseline (ms) | Latencia P95 baseline (ms) | Menor intervalo saudavel (ms) | Primeiro stress (ms) | Motivos do primeiro stress |
|---|---|---|---|---|---|---|---|---|
| WebSerial | 100 | 100.00 | 0.00 | 3.66 | 4.51 | 4 | 3 | throughput 84.06% < 95%; perdas 15.94% > 1.0%; latencia media 8.37 ms > 2x baseline 3.66 ms; P95 9.15 ms > 2x baseline 4.51 ms |
| WebSocket | 100 | 100.00 | 0.00 | 4.09 | 4.90 | 4 | 3 | throughput 82.13% < 95%; perdas 17.87% > 1.0%; latencia media 8.63 ms > 2x baseline 4.09 ms |
| REST Polling | 100 | 90.78 | 9.22 | 53.99 | 98.52 | indefinido | 100 | throughput 90.78% < 95%; perdas 9.22% > 1.0% |
