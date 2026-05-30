# PFC-1 — Análise experimental de arquiteturas e APIs Web para sensores em monitoramento esportivo

Repositório do TCC. Este projeto **não é um produto** de monitoramento esportivo: é um banco de provas para **comparar experimentalmente** diferentes arquiteturas de comunicação entre um dispositivo embarcado (Arduino) e uma aplicação web, sob carga controlada e com métricas reprodutíveis.

> Tema: Análise experimental de arquiteturas e APIs Web para integração de sensores em aplicações de monitoramento esportivo.

## Pergunta de pesquisa

Como diferentes arquiteturas de integração entre dispositivos embarcados e aplicações web influenciam **desempenho, latência, confiabilidade e capacidade de processamento** em sistemas de monitoramento esportivo?

## Objetivo geral

Comparar experimentalmente diferentes formas de integração entre um dispositivo embarcado e uma aplicação web, avaliando métricas de desempenho e comportamento sob carga.

## Arquiteturas avaliadas

A matriz experimental principal cobre três cenários (C1, C2 e C3):

| Cenário | Arquitetura | Modo | Caminho dos dados |
| --- | --- | --- | --- |
| C1 | WebSerial | direto | Arduino → Navegador (Web Serial API) |
| C2 | Backend Node.js | WebSocket | Arduino → Backend → Navegador |
| C3 | Backend Node.js | REST polling | Arduino → Backend → Navegador |

WebBluetooth, WebUSB, serverless e nuvem **não são arquiteturas implementadas**. Aparecem apenas como tecnologias relacionadas, limitações ou trabalhos futuros. Uma quarta arquitetura baseada em WebBluetooth poderá ser incluída se for viável dentro do prazo do TCC.

## Escopo: o que faz e o que não faz parte do trabalho

Faz parte do escopo:

- Simular sensores típicos de monitoramento esportivo (frequência cardíaca e aceleração X/Y/Z) em um Arduino ou simulador equivalente.
- Implementar as três arquiteturas acima como infraestrutura mínima para coleta de métricas.
- Medir **latência ponta a ponta estimada**, **throughput**, **mensagens perdidas/inválidas**, **comportamento sob carga**, **ponto de saturação** e **escalabilidade** com múltiplos clientes.
- Garantir reprodutibilidade através de uma matriz padronizada (intervalos `100, 50, 20, 10, 5, 1 ms`, 60 s por execução, 3 repetições) e da exportação automatizada dos resultados.

**Não** fazem parte do escopo (e não devem ser introduzidos sem necessidade experimental):

- Banco de dados, sistema de usuários, login/autenticação, TLS.
- Docker, Kubernetes, MQTT, cloud, serverless, edge.
- Machine Learning, processamento avançado dos dados esportivos.
- Dashboards complexos ou funcionalidades de produto.

> Toda alteração no código, na metodologia ou no artigo deve contribuir diretamente para a comparação experimental das arquiteturas. Melhorias de UI, persistência ou funcionalidades extras só são aceitáveis se servirem à medição.

## Estrutura do repositório

```text
PFC-1-/
├── arduino/
│   └── tcc_sports_sensor_standard/      # Sketch canônico (CSV: seq,send_us,hr,ax,ay,az + SYNC)
├── arquitetura-arduino-node-api/
│   └── backend/                          # C2 (WebSocket) + C3 (REST polling), Node.js + TypeScript
│       ├── src/                          # serial reader, simulator, services, http routes, websocket
│       ├── public/                       # dashboard estático (frontend de C2/C3)
│       └── scripts/scalability-test.mjs  # avaliação de 1/5/10 clientes simultâneos
├── prototypes/
│   └── webserial/                        # C1 (WebSerial direto, Arduino → navegador)
├── docs/
│   └── roteiro-experimentos.md           # Procedimento experimental detalhado (defesa do TCC)
├── scripts/
│   ├── dev-all.mjs                       # Sobe backend + webserial em paralelo
│   ├── run-experiments.mjs               # Orquestrador automatizado da matriz C1/C2/C3
│   ├── lib/                              # Runners (Playwright + cliente WS/REST), sync de relógio
│   ├── consolidate_results.py            # Junta os CSVs exportados em consolidated_metrics.csv
│   └── plot_results.py                   # Gera os gráficos (throughput, latência, perdas)
└── package.json                          # Scripts de conveniência da raiz
```

## Contrato dos dados (idêntico nas três arquiteturas)

Para que a comparação seja justa, todas as arquiteturas usam o mesmo formato CSV emitido pelo Arduino:

```text
seq,send_us,hr,ax,ay,az
```

Regras de validação:

- `seq` inteiro positivo, monotônico — saltos contam como **mensagens perdidas**.
- `send_us` em microssegundos (`micros()` do Arduino) — base do cálculo de latência.
- `hr` ∈ [40, 220] bpm.
- `ax`, `ay`, `az` ∈ [-16, 16] g.
- Linhas fora do contrato contam como **mensagens inválidas**.

## Métricas coletadas

Em cada execução, o sistema produz métricas alinhadas às variáveis de interesse do TCC:

- **Latência ponta a ponta estimada** (média, mínimo, máximo, desvio padrão e p95) — calculada via sincronização estilo NTP/Cristian (Arduino ↔ backend ↔ frontend), com incerteza limitada por `RTT_sync / 2` por elo. Sem SYNC válido, é marcada explicitamente como `latency_method = relative_offset_*`.
- **Throughput**: mensagens por segundo e percentual em relação ao esperado.
- **Perdas**: `missing_messages` (esperadas − recebidas) e `sequence_gap_messages` (saltos de `seq`).
- **Mensagens inválidas** (linhas fora do contrato).
- **Ponto de saturação** e limite operacional por intervalo de envio.
- **Escalabilidade**: 1, 5 e 10 clientes simultâneos em REST polling e WebSocket (`npm run test:scale`).

> A latência é uma **estimativa de one-way latency** com incerteza documentada, não uma medição física absoluta. Validação física exigiria instrumentação externa (analisador lógico/osciloscópio) — fora do escopo deste TCC.

## Pré-requisitos

- Node.js 20 ou superior.
- npm.
- Python 3.10+ com `matplotlib` (somente para os gráficos finais).
- Placa Arduino compatível com `micros()` e USB serial (campanha principal). O simulador embutido no backend e no WebSerial roda sem hardware.
- Navegador baseado em Chromium (Chrome ou Edge desktop) para usar a Web Serial API.

## Instalação

```powershell
npm install
npm run install:all
```

Para a campanha automatizada:

```powershell
npx playwright install chromium
```

## Execução em desenvolvimento

Subir backend (C2/C3) e WebSerial (C1) ao mesmo tempo:

```powershell
npm run dev
```

- Backend (dashboard de C2/C3): `http://localhost:3000`
- WebSerial (dashboard de C1): `http://localhost:8765`

Apenas backend:

```powershell
npm run dev:backend
```

Apenas WebSerial:

```powershell
npm run dev:webserial
```

> O Arduino e o backend **não podem** usar a mesma porta serial ao mesmo tempo. Para C1, o backend deve estar parado; para C2/C3, o WebSerial deve estar fechado.

## Reprodutibilidade — execução automatizada da matriz

A campanha completa (`C1 + C2 + C3`, 6 intervalos, 3 repetições, 60 s cada) é orquestrada por `scripts/run-experiments.mjs`. Ele inicia/encerra os servidores, controla o Chromium via Playwright para C1, age como cliente WebSocket/REST para C2/C3, sincroniza relógios via `POST /clock/sync` e exporta CSV/JSON com nomes padronizados.

Bootstrap único da permissão Web Serial (apenas na primeira vez por máquina):

```powershell
node scripts/run-experiments.mjs --bootstrap-webserial --serial-port COM3
```

Campanha principal com Arduino:

```powershell
node scripts/run-experiments.mjs --source serial --serial-port COM3 --reps 3
```

Campanha auxiliar com simulador (sem Arduino):

```powershell
node scripts/run-experiments.mjs --source simulator --reps 3
```

Saídas em `resultados/` (formato: `<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<n>_<timestamp>_<tipo>.<ext>`):

- `*_sensor-data.csv` — uma linha por amostra observada no frontend.
- `*_metrics.csv` — uma linha por execução/intervalo (esperadas, recebidas, perdas, throughput, latência).
- `*_campaign-summary.csv` — uma linha por intervalo da campanha stress, pronta para gráficos.
- `*_experiment-summary.json` — configuração, blocos `latency`, `clockSync`, `limitations` e notas de interpretação.

O orquestrador suporta retomada automática (pula reps já completas), continuação após falha individual e log de heartbeat — desenhado para campanhas longas (overnight). Veja a seção "Execução automatizada" em [`docs/roteiro-experimentos.md`](docs/roteiro-experimentos.md) para todas as flags.

## Avaliação de escalabilidade

Com o backend rodando:

```powershell
npm run test:scale
```

Executa REST polling e WebSocket com 1, 5 e 10 clientes simulados e gera um CSV com mensagens/s, perdas detectadas e estabilidade por cliente.

## Análise dos resultados

Após coletar `resultados/`:

```powershell
python scripts/consolidate_results.py resultados
python scripts/plot_results.py resultados
```

Gera:

- `resultados/consolidated_metrics.csv` — todos os `metrics.csv` e `campaign-summary.csv` em uma só tabela.
- `resultados/plots/throughput_percent.png`
- `resultados/plots/estimated_latency_avg_ms.png`
- `resultados/plots/estimated_latency_p95_ms.png`
- `resultados/plots/missing_messages.png`

## Endpoints relevantes do backend (C2/C3)

```text
GET  /health
GET  /data/latest
GET  /metrics
GET  /clock                      # relógio do backend (debug)
POST /clock/sync                 # sincronização NTP/Cristian (frontend ↔ backend)
POST /experiments/start
POST /experiments/stop
POST /experiments/reset
POST /experiments/observations   # frontend reporta amostras observadas
GET  /experiments/current
GET  /experiments/export
```

## Análise qualitativa de segurança

Tratada qualitativamente porque o protótipo **não implementa** TLS, autenticação ou autorização — uma decisão consciente de escopo, não uma omissão.

| Critério | WebSerial (C1) | Backend Node.js (C2/C3) |
| --- | --- | --- |
| Permissão do usuário | Autorização explícita do navegador | Não acessa o dispositivo diretamente pelo navegador |
| Exposição em rede | Baixa (uso local) | Maior (HTTP + WebSocket abertos) |
| Compatibilidade | Limitada a navegadores com Web Serial API | Mais ampla para clientes web |
| Risco principal | Acesso físico/local ao dispositivo | Endpoints abertos, CORS e WS sem autenticação |

## Resultado esperado do TCC

Os experimentos devem permitir identificar, com base nos CSVs e gráficos consolidados:

- Qual arquitetura apresenta menor latência ponta a ponta estimada.
- Qual arquitetura sustenta maior throughput.
- Em qual ponto cada arquitetura **começa a degradar** (saturação) e qual o limite operacional recomendado.
- Vantagens e limitações de cada abordagem (incluindo segurança qualitativa, compatibilidade e operacionalidade).
- Qual arquitetura é mais adequada para aplicações web de monitoramento esportivo em tempo real.

## Limitações declaradas

- A latência fim a fim é **estimativa**, com incerteza dominada por `RTT_sync / 2` em cada elo.
- Métricas em memória — são perdidas ao reiniciar o processo (por isso a exportação por execução é obrigatória).
- O simulador não substitui completamente as características de uma porta serial real; por isso a campanha principal deve usar Arduino, e o simulador é tratado como fonte auxiliar (campo `source` no JSON exportado).
- Sem banco de dados, autenticação, TLS, nuvem ou orquestração — por decisão de escopo.
- Resultados são válidos para o ambiente medido (uma única máquina, USB serial local). Não generalizam para infraestrutura distribuída em produção.

## Documentação detalhada

- [`docs/roteiro-experimentos.md`](docs/roteiro-experimentos.md) — procedimento experimental, matriz, sincronização de relógio, interpretação dos CSVs, execução overnight e cuidados na defesa.
- [`arquitetura-arduino-node-api/README.md`](arquitetura-arduino-node-api/README.md) — backend Node.js (C2 e C3), endpoints, configuração `.env`, exportações.
- [`prototypes/webserial/README.md`](prototypes/webserial/README.md) — protótipo WebSerial direto (C1).
- [`arduino/tcc_sports_sensor_standard/`](arduino/tcc_sports_sensor_standard/) — sketch canônico do Arduino com protocolo CSV e suporte a `SYNC,<client_t0>` / `INTERVAL_MS=` / `INTERVAL_US=`.
