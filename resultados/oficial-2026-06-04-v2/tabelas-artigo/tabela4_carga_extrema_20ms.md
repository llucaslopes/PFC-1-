# Tabela 4 — Confiabilidade sob carga agressiva (20 ms)

Comportamento das três arquiteturas sob o intervalo mais agressivo da matriz (20 ms = 50 msg/s). A 20 ms o produtor pressiona o canal de comunicação ao limite. REST polling e WebSocket colapsam para ~22% de throughput porque o cliente/servidor não acompanha; MQTT sustenta ~98% porque o broker desacopla produtor e consumidor (fila assíncrona, sem polling síncrono no cliente). 3 repetições de 60 s; valores são média ± desvio padrão.

| Arquitetura | Mensagens esperadas (3000/rep) | Mensagens entregues (média) | Throughput (%) | Perdas (%) | Latência média (ms) | Latência P95 (ms) |
|---|---|---|---|---|---|---|
| WebSocket | 3000 | 665 | 22.16 ± 0.73 | 77.84 ± 0.73 | 33.33 ± 4.54 | 105.70 ± 14.94 |
| REST polling | 3000 | 660 | 22.00 ± 0.70 | 78.00 ± 0.70 | 57.72 ± 3.61 | 125.89 ± 9.99 |
| MQTT | 3000 | 2934 | 97.81 ± 0.10 | 2.19 ± 0.10 | 14.98 ± 1.91 | 69.78 ± 3.88 |
