# Tabela 1 — Comparação executiva entre arquiteturas

Síntese da campanha oficial (ESP32 + Wi-Fi, 3 repetições de 60 s). Coluna esquerda mostra o comportamento no intervalo saudável de 100 ms (cada padrão no seu "melhor caso"); coluna direita mostra o comportamento sob carga agressiva de 20 ms (5× o baseline). Valores são média ± desvio padrão das 3 repetições. Fonte: resultados/oficial-2026-06-04-v2/consolidated_metrics.csv.

| Arquitetura | Throughput @ 100 ms (%) | Latência média @ 100 ms (ms) | Latência P95 @ 100 ms (ms) | Throughput @ 20 ms (%) | Mensagens entregues @ 20 ms (msg/s) | Perdas @ 20 ms (%) |
|---|---|---|---|---|---|---|
| WebSocket | 91.06 ± 4.95 | 31.57 ± 3.76 | 86.49 ± 35.84 | 22.16 ± 0.73 | 11.08 ± 0.37 | 77.84 ± 0.73 |
| REST polling | 82.11 ± 0.67 | 83.16 ± 2.12 | 138.19 ± 6.63 | 22.00 ± 0.70 | 11.00 ± 0.35 | 78.00 ± 0.70 |
| MQTT | 99.83 ± 0.00 | 2.81 ± 0.60 | 25.62 ± 4.28 | 97.81 ± 0.10 | 48.90 ± 0.05 | 2.19 ± 0.10 |
