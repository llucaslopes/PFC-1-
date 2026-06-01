# Tabela 4 – Uso de recursos do backend (produtor a 100 ms)

Amostragem de CPU e memoria do processo backend Node via endpoint `/health/process` durante a execucao. Apenas backends WebSocket e REST Polling, ja que WebSerial nao tem processo intermediario.

| Arquitetura | N clientes | CPU media (%) | CPU desv (%) | CPU P95 (%) | CPU max (%) | RSS media (MB) | RSS desv (MB) | RSS max (MB) | Heap usado medio (MB) | N reps |
|---|---|---|---|---|---|---|---|---|---|---|
| REST Polling | 1 | 4.32 | 0.54 | 10.51 | 15.68 | 84.81 | 11.98 | 88.71 | 18.12 | 3 |
| REST Polling | 2 | 4.23 | 0.55 | 9.45 | 14.49 | 102.01 | 1.11 | 102.89 | 21.41 | 3 |
| REST Polling | 5 | 5.44 | 0.45 | 14.61 | 21.47 | 98.59 | 6.31 | 104.29 | 20.39 | 3 |
| REST Polling | 10 | 6.91 | 0.35 | 18.43 | 26.88 | 104.67 | 0.46 | 105.46 | 21.21 | 3 |
| REST Polling | 20 | 9.99 | 0.86 | 22.59 | 26.46 | 103.45 | 2.84 | 105.59 | 21.08 | 3 |
| WebSocket | 1 | 4.15 | 0.24 | 7.40 | 12.37 | 69.30 | 1.52 | 72.36 | 14.18 | 3 |
| WebSocket | 2 | 3.97 | 0.51 | 7.39 | 10.39 | 74.96 | 1.98 | 75.51 | 16.39 | 3 |
| WebSocket | 5 | 3.67 | 0.59 | 6.43 | 8.40 | 76.71 | 0.27 | 76.96 | 16.67 | 3 |
| WebSocket | 10 | 4.29 | 0.12 | 6.40 | 9.40 | 77.34 | 0.19 | 77.71 | 16.15 | 3 |
| WebSocket | 20 | 4.75 | 0.11 | 7.40 | 11.60 | 78.86 | 0.05 | 78.98 | 18.36 | 3 |
