# Tabela 3 — Latência ponta a ponta no baseline saudável (100 ms)

Latência estimada ponta a ponta (ESP32 → backend/broker → cliente) no intervalo de 100 ms, onde todas as arquiteturas operam em regime saudável (throughput ≥ 95%). Sincronização via SNTP no ESP32 e Cristian/NTP simplificado no cliente; incerteza ~ RTT_sync / 2. MQTT entrega latência sub-milissegundo a média porque o broker é local e a fila do producer é pequena; REST polling acumula latência inerente do mecanismo (cliente busca no próprio passo).

| Arquitetura | Latência média (ms) | Latência P95 (ms) | Desvio padrão da latência (ms) | Throughput (%) | Perdas (%) |
|---|---|---|---|---|---|
| A1 — WebSocket | 31.57 ± 3.76 | 86.49 ± 35.84 | 32.69 ± 8.26 | 91.06 ± 4.95 | 8.94 ± 4.95 |
| A2 — REST polling | 83.16 ± 2.12 | 138.19 ± 6.63 | 33.66 ± 1.21 | 82.11 ± 0.67 | 17.89 ± 0.67 |
| A4 — MQTT | 2.81 ± 0.60 | 25.62 ± 4.28 | 8.43 ± 1.28 | 99.83 ± 0.00 | 0.17 ± 0.00 |
