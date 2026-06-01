# Tabela 5 – Comparacao final entre as arquiteturas

Sintese para o corpo do artigo. Combina resultados das duas campanhas: (a) baseline saudavel a 100 ms e ponto de stress (escalabilidade vertical); (b) carga maxima testada N=20 no produtor a 100 ms (escalabilidade horizontal). WebSerial nao se aplica a multi-cliente.

| Arquitetura | Suporta multi-cliente | Throughput baseline 100 ms (%) | Perdas baseline 100 ms (%) | Latencia media 100 ms (ms) | Latencia P95 100 ms (ms) | Throughput em 1 ms (%) | Menor intervalo saudavel (ms) | Throughput agreg. N=20 (msg/s) | CPU N=20 (%) | RSS N=20 (MB) |
|---|---|---|---|---|---|---|---|---|---|---|
| WebSerial | Nao (1) | 100.00 | 0.00 | 3.66 | 4.51 | 28.02 | 4 | 9.99 | n/a | n/a |
| WebSocket | Sim | 100.00 | 0.00 | 4.09 | 4.90 | 27.17 | 4 | 200.00 | 4.75 | 78.86 |
| REST Polling | Sim | 90.78 | 9.22 | 53.99 | 98.52 | 7.01 | indefinido | 182.89 | 9.99 | 103.45 |
