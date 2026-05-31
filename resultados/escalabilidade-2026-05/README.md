# Campanha de escalabilidade — 2026-05

Esta pasta contém os resultados de uma campanha **dedicada de escalabilidade** que compara as três arquiteturas avaliadas no TCC sob uma matriz mais densa de intervalos de envio. Os resultados antigos (`resultados/*` fora desta subpasta) **não foram alterados**: esta campanha vive isolada para que o ponto de stress de cada arquitetura possa ser identificado sem ambiguidade.

> Esta campanha **complementa** (não substitui) a campanha oficial (`run-experiments.mjs --campaign official`) e a campanha de refinamento (`run-experiments.mjs --campaign refinement`). Os arquivos antigos continuam servindo como referência histórica.

## 1. Como os testes foram executados

Comando único:

```powershell
node scripts/run-scalability-campaign.mjs --serial-port COM3
```

Ou, equivalentemente:

```powershell
npm run experiment:scalability
```

Esse orquestrador:

1. Resolve a porta serial do Arduino (auto-detecção ou `--serial-port COM3`).
2. Para cada cenário (`webserial`, `websocket`, `rest-polling`), inicia o servidor correspondente e roda **9 intervalos × 3 repetições × 60 s** de coleta. A campanha tem `campaignType = "scalability"`, então todos os arquivos gerados carregam o infixo `_scalability_` e ficam apenas dentro desta pasta.
3. Mantém o Windows acordado durante a execução (`keep-awake.mjs`).
4. Salva os 4 artefatos por repetição (sensor-data, metrics, campaign-summary, experiment-summary) gerados pela infraestrutura existente.
5. Ao final, invoca automaticamente o pós-processamento Python (`scalability_metrics.py` + `plot_scalability.py`).

### Reproduzir apenas algumas partes

```powershell
# Só uma arquitetura
node scripts/run-scalability-campaign.mjs --scenarios c2

# Sem hardware (sanity-check com simulador embutido)
node scripts/run-scalability-campaign.mjs --source simulator

# Só refazer o pós-processamento (sem coletar de novo)
python scripts/scalability_metrics.py resultados/escalabilidade-2026-05
python scripts/plot_scalability.py    resultados/escalabilidade-2026-05
```

A flag `--no-resume` força reexecução de repetições que já tenham `experiment-summary.json` desta campanha. Por padrão (`resume`), repetições já concluídas são puladas, permitindo retomar interrupções.

## 2. Intervalos testados

Matriz progressiva, do mais leve para o mais agressivo:

```
100 ms, 50 ms, 20 ms, 10 ms, 5 ms, 4 ms, 3 ms, 2 ms, 1 ms
```

São **9 intervalos**. A escolha mistura os intervalos da campanha oficial (`100, 50, 20, 10, 5, 1`) com os da campanha de refinamento de saturação (`4, 3, 2`), produzindo uma curva contínua que permite localizar o joelho de cada arquitetura.

## 3. Repetições

- **3 repetições por intervalo**, **por arquitetura**.
- Cada repetição dura **60 segundos** (`durationSeconds = 60`).
- Total por arquitetura: 9 × 3 × 60 s = **27 minutos efetivos** de captura (mais overhead de sync, setup do Chromium, etc.).
- Total das três arquiteturas: aproximadamente **80–100 minutos** de execução.

## 4. Como a latência é calculada

A latência fim a fim é uma **estimativa**, não uma medição física absoluta:

1. **C2/C3 (backend)**: o backend faz sincronização estilo NTP/Cristian com o Arduino (`POST /clock/sync` interno) e o cliente (este orquestrador) faz nova sincronização com o backend. O offset Arduino→backend é somado ao offset backend→frontend, e a latência por amostra é:

   ```
   latencia_amostra_ms = receive_ms_frontend - (send_us_arduino/1000 + offset_arduino_to_frontend)
   ```

2. **C1 (WebSerial)**: o navegador conversa diretamente com o Arduino. Antes da campanha, o protótipo coloca o Arduino em intervalo seguro de 100 ms e roda um SYNC NTP-like (`SYNC,<id>` / `SYNC_REPLY,...`) para estimar offset Arduino↔navegador.

3. **Fallback (`relative_offset_*`)**: quando o SYNC falha (porta serial saturada, sketch antigo etc.), a infra cai num modo relativo — a coluna `latency_method` no `_sensor-data.csv` marca isso explicitamente, e o JSON resumido inclui `latencyType = "relative_fallback"`.

4. **Mediana / P95 / P99**: calculados em pós-processamento pelo `scalability_metrics.py` diretamente sobre a coluna `end_to_end_latency_ms` do arquivo bruto de amostras. Mediana e P99 não estavam na infra de runtime; foram adicionados aqui sem alterar o pipeline antigo.

> A incerteza dessa estimativa é dominada por `RTT_sync / 2` em cada elo. As colunas `clock_uncertainty_ms` e `sync_rtt_ms` no `_sensor-data.csv` permitem auditar a qualidade do sync amostra a amostra.

## 5. Métricas coletadas

Para **cada repetição** (`<base>_scalability-summary.csv` e `<base>_scalability-summary.json`):

| Campo | Significado |
|---|---|
| `architecture` | `webserial`, `backend-node` |
| `communication_mode` | `webserial`, `websocket`, `rest-polling` |
| `source` | `serial` (Arduino) ou `simulator` |
| `interval_ms` | Intervalo configurado para o Arduino/simulador |
| `repetition` | Número da repetição (1, 2 ou 3) |
| `duration_seconds` | Duração efetiva da repetição (60 s) |
| `expected_messages` | `floor(duration_ms / interval_ms)` |
| `received_messages` | Linhas válidas em `sensor-data.csv` para a repetição |
| `missing_messages` | `expected_messages − received_messages` |
| `invalid_messages` | Linhas que falharam no parser/validação |
| `loss_rate_percent` | `100 × missing_messages / expected_messages` |
| `throughput_messages_per_second` | `received_messages / duration_seconds` |
| `throughput_percent` | `100 × received_messages / expected_messages` |
| `latency_avg_ms` | Média da latência por amostra |
| `latency_median_ms` | **Mediana** (P50) da latência por amostra |
| `latency_min_ms` / `latency_max_ms` | Extremos |
| `latency_std_ms` | Desvio padrão amostral |
| `latency_p95_ms` | Percentil 95 |
| `latency_p99_ms` | **Percentil 99** |
| `latency_samples` | Quantidade de amostras com latência finita |
| `latency_method` | `ntp_style_clock_synchronization` ou `relative_offset_*` |

Para a **campanha inteira**:

- `consolidated_metrics.csv` — todas as repetições, uma linha por execução.
- `consolidated_metrics.json` — estrutura aninhada com:
  - `campaign`: metadados da campanha;
  - `thresholds`: limiares usados para detectar stress point;
  - `runs`: lista de execuções (espelhando o CSV);
  - `aggregated_per_interval`: média das 3 repetições para cada `(arquitetura, intervalo)`;
  - `stress_points`: para cada arquitetura, o **maior `interval_ms` (= maior taxa, menor período) que ainda satisfaz todas as condições de saúde**, e o **primeiro intervalo comprometido** (o próximo intervalo abaixo) com o motivo do stress.

### Definição de stress point

Uma execução é considerada comprometida se **pelo menos uma** das condições for verdadeira:

| Critério | Limiar |
|---|---|
| `throughput_percent < 95` | Throughput abaixo de 95% do esperado |
| `loss_rate_percent > 1.0` | Perdas acima de 1% |
| `latency_avg_ms >= 2 × baseline_avg` | Latência média ≥ 2× a do intervalo baseline |
| `latency_p95_ms >= 2 × baseline_p95` | P95 ≥ 2× o do intervalo baseline |

O **baseline** é o intervalo de **100 ms** (intervalo mais leve da matriz). A média das 3 repetições é usada para determinar o stress point por arquitetura (uma execução isolada ruidosa não muda a classificação).

## 6. Gráficos comparativos

Em `plots/`:

| Arquivo | Conteúdo |
|---|---|
| `throughput_por_arquitetura_e_intervalo.png` | Throughput efetivo (%) por arquitetura, eixo X log de intervalos |
| `perdas_por_arquitetura_e_intervalo.png` | Taxa de perdas (%) por arquitetura |
| `latencia_media_por_arquitetura_e_intervalo.png` | Latência média estimada (ms) por arquitetura |
| `latencia_p95_por_arquitetura_e_intervalo.png` | Latência P95 estimada (ms) por arquitetura |

Cada série tem 3 pontos por intervalo (uma por repetição); os gráficos plotam **média ± desvio padrão** das 3 repetições e marcam (linha vertical) o stress point detectado para a arquitetura.

## 7. Como interpretar os arquivos gerados

Estrutura desta pasta após uma execução completa:

```
resultados/escalabilidade-2026-05/
├── README.md                                              (este arquivo)
├── consolidated_metrics.csv                                (uma linha por execução)
├── consolidated_metrics.json                               (estrutura completa + stress points)
├── plots/
│   ├── throughput_por_arquitetura_e_intervalo.png
│   ├── perdas_por_arquitetura_e_intervalo.png
│   ├── latencia_media_por_arquitetura_e_intervalo.png
│   └── latencia_p95_por_arquitetura_e_intervalo.png
├── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_<timestamp>_scalability_sensor-data.csv         (bruto, uma linha por amostra; todos os intervalos da rep)
├── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_<timestamp>_scalability_metrics.csv             (gerado pela infra, sem mediana/P99)
├── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_<timestamp>_scalability_campaign-summary.csv    (gerado pela infra)
├── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_<timestamp>_scalability_experiment-summary.json (gerado pela infra)
├── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_scalability-summary.csv                        (pós-processado, COM mediana/P99/loss_rate)
└── <arq>_<modo>_<fonte>_<intervalo>ms_rep<N>_scalability-summary.json                       (pós-processado)
```

**Convenções de nome:**

- `<arq>` ∈ {`webserial`, `backend-node`}
- `<modo>` ∈ {`webserial`, `websocket`, `rest-polling`}
- `<fonte>` ∈ {`serial`, `simulator`}
- `<intervalo>` é o último intervalo da repetição (o arquivo de uma rep agrupa todos os intervalos daquela rep)
- `<N>` é a repetição (1–3)
- `<timestamp>` é ISO 8601 com `:` e `.` substituídos por `-`

**Como consultar:**

- Para responder *"qual a latência média do WebSocket em 5 ms na rep 2?"* → procure em `consolidated_metrics.csv` a linha com `architecture=backend-node`, `communication_mode=websocket`, `interval_ms=5`, `repetition=2`.
- Para inspecionar amostras individuais (jitter, distribuição da cauda etc.) → abra o `_sensor-data.csv` correspondente.
- Para o stress point de cada arquitetura → bloco `stress_points` em `consolidated_metrics.json` ou as linhas verticais nos gráficos.

## 8. Limitações declaradas

- **Latência é estimativa**, não medição física. A incerteza é dominada por `RTT_sync / 2` em cada elo. Validação física exigiria instrumentação externa (analisador lógico/osciloscópio) — fora do escopo do TCC.
- Métricas são coletadas em uma única máquina, com USB serial local. Não generalizam para infraestrutura distribuída ou em produção.
- A frequência efetiva do Arduino em `1 ms` depende do sketch e do baud rate; em geral o Arduino satura antes de 1 ms por mensagem, então `interval_ms = 1` mede mais o limite do hardware do que da arquitetura web. Esse é o ponto da matriz: deixar todas as arquiteturas baterem no teto para enxergar onde **cada uma** primeiro degrada.
- O simulador (`--source simulator`) **não substitui** o Arduino real para análise oficial. Use apenas para validar a pipeline (ex.: testar mudanças no dashboard sem hardware).
- REST polling em intervalos grandes (≥ 50 ms) ainda usa polling de 1 ms no cliente. A "latência" reportada nesse caso reflete mais o atraso do polling do que o transporte; isso é esperado e está documentado no `plot_scalability.py`.
- Sem banco de dados, autenticação, TLS, nuvem ou orquestração — por decisão de escopo.

## 9. Arquivos relacionados (fora desta pasta)

- `scripts/run-scalability-campaign.mjs` — orquestrador da campanha.
- `scripts/scalability_metrics.py` — recálculo de métricas + consolidação + stress point.
- `scripts/plot_scalability.py` — geração dos 4 gráficos.
- `scripts/lib/` — runners reutilizados (não modificados).
- `docs/roteiro-experimentos.md` — procedimento experimental detalhado do TCC.
