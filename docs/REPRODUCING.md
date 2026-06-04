# Guia de Reprodução

Este documento permite que **um terceiro** (avaliador, banca, outro
pesquisador) reproduza, do zero, os resultados oficiais do TCC
publicados em `resultados/oficial-2026-06-04-v2/`.

Se este for o seu primeiro contato com o projeto, leia primeiro o
[`README.md`](../README.md) na raiz para entender a pergunta de
pesquisa, o escopo e as arquiteturas avaliadas. Este guia foca em
**execução passo-a-passo**, não em fundamentação.

> **Tempo total esperado:** ~50 min sem hardware (campanha via
> simulador), ~80 min com hardware (ESP32 real). O smoke test inicial
> (Seção 4) confirma em <2 min se o ambiente está pronto antes de você
> investir tempo na campanha completa.

---

## 0. Sumário do que será reproduzido

A campanha **oficial** cobre **3 padrões principais + 1 complementar**:

| Tag | Padrão | Implementação |
|---|---|---|
| `a1` | WebSocket (full-duplex) | Backend Node + WS broadcast |
| `a2` | REST polling | Backend Node + HTTP polling |
| `a4` | MQTT / Pub-Sub | Broker Mosquitto + bridge Node |
| `a3` | Serverless (complementar) | Vercel Functions + Vercel KV |

Matriz: **6 intervalos** (1000, 500, 200, 100, 50, 20 ms) × **3 reps**
× **60 s** cada × **3 ou 4 arquiteturas** = 54 ou 72 execuções.

Saídas esperadas:

- `resultados/<sua-pasta>/*_metrics.csv` (1 por execução)
- `resultados/<sua-pasta>/*_sensor-data.csv` (1 por execução)
- `resultados/<sua-pasta>/*_experiment-summary.json` (1 por execução)
- `resultados/<sua-pasta>/consolidated_metrics.csv` (consolidado final)
- `resultados/<sua-pasta>/plots/*.png` (11 figuras)
- `resultados/<sua-pasta>/tabelas-artigo/*.{csv,md,png}` (5 tabelas)

---

## 1. Pré-requisitos verificáveis

### Software (todos os perfis)

| Ferramenta | Versão mínima | Como verificar |
|---|---|---|
| Node.js | 20.x | `node --version` |
| npm | 10.x (vem com Node) | `npm --version` |
| Python | 3.10+ | `python --version` |
| Git | qualquer | `git --version` |

### Software opcional (só para a campanha MQTT oficial)

| Ferramenta | Para quê | Como verificar |
|---|---|---|
| Docker Desktop | Subir Mosquitto local para A4 | `docker --version` e `docker ps` |
| Arduino IDE 2.x | Gravar firmware no ESP32 | abre a IDE |

> **Sem Docker?** A bridge MQTT cai automaticamente para o broker
> embarcado `aedes` em modo dev. Funciona para smoke test e dev local;
> **a campanha oficial recomenda Mosquitto** para isolar a medição do
> processo da bridge.

### Hardware (só para a campanha "oficial wifi-http")

- 1× ESP32-WROOM-32 (qualquer dev board com ESP32 + Wi-Fi)
- 1× rede Wi-Fi 2.4 GHz com SSID/senha conhecidos
- 1× computador host (Windows/Linux/Mac) na **mesma rede do ESP32**

> **Sem ESP32?** Pule para a Seção 6 ("Reprodução via simulador").
> O simulador (`scripts/esp32-simulator.mjs`) gera carga HTTP/MQTT
> idêntica ao firmware, então a campanha **roda inteira** sem hardware
> — só perde a fidelidade Wi-Fi (passa a medir loopback).

---

## 2. Clone e instalação (5 min)

```bash
git clone https://github.com/llucaslopes/PFC-1- pfc1
cd pfc1
npm install
npm run install:all
```

Dependências Python:

```bash
pip install pandas matplotlib numpy
```

> **Verificação 1:** `npm run build:backend` deve terminar sem erros.
> **Verificação 2:** `npm run build:serverless` deve terminar sem erros.

---

## 3. Bateria de testes (3 min)

Antes de qualquer experimento, confirme que o código está consistente
com os baselines:

```bash
# 171 testes Node
node --test scripts/tests/*.test.mjs scripts/tests/test_collection_parity.mjs

# 35 testes Python (paridade entre lib_mjs e lib_py)
python -m pytest scripts/tests/test_lib_py.py scripts/tests/test_pos_processing_parity.py
```

Esperado: `pass 206, fail 0`. Se algum teste falhar, **pare aqui** e
abra uma issue — o resto do guia não vai funcionar.

---

## 4. Smoke test (2 min, sem hardware)

```bash
npm run experiment:smoke
```

Este comando:
1. Sobe backend Node em `:3000` (A1/A2)
2. Sobe bridge MQTT em `:4002` com broker embarcado (A4)
3. Spawna `scripts/esp32-simulator.mjs` como subprocesso para cada
   arquitetura, gerando 15 s de tráfego a 100 ms de intervalo
4. Persiste métricas em `resultados/smoke-validation/`

**Critério de sucesso:**

```bash
ls resultados/smoke-validation/*_metrics.csv | wc -l   # deve ser >= 3
```

Cada `*_metrics.csv` deve ter:
- `totalReceivedMessages` > 100
- `missingMessagesPercent` < 5
- `httpStatusDistribution` com >95% em `2xx`

> Se o smoke test passar, **o ambiente está pronto para a campanha
> completa**. Se falhar, veja a Seção 9 (Troubleshooting).

---

## 5. Campanha oficial COM ESP32 (~80 min)

### 5.1 Configurar o firmware

```bash
cd embedded/esp32_sports_sensor_wifi
cp secrets.h.example secrets.h
# Edite secrets.h com seu editor preferido:
#   - WIFI_SSID, WIFI_PASSWORD            (sua rede Wi-Fi 2.4 GHz)
#   - BACKEND_URL, BACKEND_HTTP_BASE      (IP LAN do seu PC + portas)
#   - MQTT_HOST, MQTT_BRIDGE_HTTP_BASE    (mesmo IP LAN do PC)
```

> **Não use `localhost`/`127.0.0.1` nos URLs**: do ponto de vista do
> ESP32, isso aponta para o próprio chip. Descubra seu IP LAN com
> `ipconfig` (Windows) ou `ip addr` (Linux).

### 5.2 Gravar o firmware (uma única vez para A1+A2+A4)

1. Abra `esp32_sports_sensor_wifi.ino` no Arduino IDE 2.x
2. **Tools → Board** → `ESP32 Dev Module`
3. **Tools → Port** → selecione a porta COM do ESP32
4. **Sketch → Upload** (Ctrl+U)
5. Abra **Serial Monitor** a 115200 baud para confirmar:
   - `[boot] PFC-1 sketch dual-active (HTTP_BACKEND + HTTP_SERVERLESS + MQTT)`
   - `[wifi] conectado: ip=<algum-ip>`
   - `[sntp] sincronizado: epoch=...`

O firmware é **dual-active**: o mesmo binário cobre A1, A2, A3 e A4. A
campanha oficial não exige recompilar entre cenários — o ESP32 detecta
quando o orquestrador derruba o backend HTTP e sobe a bridge MQTT, e
migra o transporte ativo sozinho em 300–600 ms a 100 ms de intervalo
(ver `embedded/esp32_sports_sensor_wifi/README.md`, seção "Failover").

### 5.3 Confirmar conectividade

Com o backend rodando em outro terminal:

```bash
npm run dev:backend
```

Em outro terminal, valide que o ESP32 está enviando:

```bash
curl http://localhost:3000/metrics
# Esperado: totalReceivedMessages > 0 em <10s
```

Se o contador ficar em `0`:
- Cheque firewall do PC liberando a porta 3000
- Cheque se o ESP32 está na mesma rede Wi-Fi (não no Wi-Fi do celular)
- Veja o Serial Monitor: erros HTTP aparecem como `[http] POST falhou`

### 5.4 Executar a campanha A1+A2+A4

```bash
npm run experiment:oficial
```

Este alias executa exatamente:

```bash
node scripts/run-experiments.mjs \
  --scenarios a1,a2,a4 \
  --reps 3 \
  --duration 60 \
  --intervals 1000,500,200,100,50,20 \
  --results-dir resultados/oficial-2026-06-04-v2 \
  --log-file logs/campanha-oficial-2026-06-04-v2.log
```

Saídas durante a execução (~80 min total):
- `[orchestrator]` no stdout indicando arquitetura/intervalo/rep
- `[backend]` / `[mqtt-bridge]` logs dos serviços ativos
- Heartbeat a cada 10 s (`[heartbeat] msgs=X invalid=Y`)

> O orquestrador **suporta retomada**: se cair na rep 15/54, basta
> re-rodar o mesmo comando que ele pula as reps com arquivo já
> gravado.

### 5.5 Campanha complementar A3 (serverless, opcional)

A3 exige Vercel CLI configurado e dois jeitos de rodar:

**Opção A — local com `dev-server.mjs`** (não mede cold start real):

```bash
node scripts/run-experiments.mjs --scenarios a3 --reps 3 \
  --intervals 1000,500,200,100,50,20 \
  --results-dir resultados/oficial-2026-06-04-v2
```

**Opção B — deployment Vercel real** (mede cold start real):

```bash
cd arquitetura-serverless
vercel link          # link com seu projeto Vercel
vercel env pull      # baixa KV_REST_API_URL/TOKEN
cd ..

node scripts/run-experiments.mjs --scenarios a3 --reps 3 \
  --serverless-base-url https://<seu-projeto>.vercel.app \
  --serverless-api-key "$INGEST_API_KEY" \
  --results-dir resultados/oficial-2026-06-04-v2
```

---

## 6. Reprodução via simulador (~50 min, sem hardware)

Substitui o ESP32 pelo `scripts/esp32-simulator.mjs`, que gera o
**mesmo payload** com a **mesma cadência** mas via subprocess Node.
Útil para reprodutibilidade em CI, em máquina de banca/avaliador, ou
em ambientes sem acesso ao hardware do clube.

```bash
node scripts/run-experiments.mjs \
  --source simulator-http \
  --scenarios a1,a2,a4 \
  --reps 3 \
  --duration 60 \
  --intervals 1000,500,200,100,50,20 \
  --results-dir resultados/repro-simulator
```

> **O que muda em relação ao oficial:** todas as métricas de rede
> Wi-Fi (`wifi_rssi_dbm`, `wifi_reconnects`, jitter de rádio) viram
> zero/ruído de loopback. Todas as métricas de protocolo (throughput,
> latência de processamento, status HTTP, fairness) permanecem
> válidas e diretamente comparáveis com a campanha oficial.

---

## 7. Análise e geração de figuras (~5 min)

```bash
python scripts/consolidate_results.py resultados/oficial-2026-06-04-v2
python scripts/plot_results.py        resultados/oficial-2026-06-04-v2
python scripts/gera_tabelas_artigo.py --input resultados/oficial-2026-06-04-v2/consolidated_metrics.csv \
                                      --out   resultados/oficial-2026-06-04-v2/tabelas-artigo
```

Gera, na pasta da campanha:
- `consolidated_metrics.csv` — todos os `metrics.csv` em uma tabela única
- `plots/` — 11 PNGs cobrindo throughput, latência avg/p95, perdas, jitter
- `tabelas-artigo/` — 5 tabelas (CSV + Markdown + PNG editável)

---

## 8. Como confirmar que reproduziu corretamente

Compare seu `consolidated_metrics.csv` com o de referência em
`resultados/oficial-2026-06-04-v2/`. Os números absolutos podem variar
por hardware/Wi-Fi, mas as **conclusões qualitativas** devem se manter:

| Critério qualitativo | Esperado |
|---|---|
| Em **100 ms**, throughput A4 > A1 > A2 | A4 ≈ 99 %, A1 ≈ 91 %, A2 ≈ 82 % |
| Em **20 ms**, A1/A2 saturam, A4 mantém-se | A1/A2 ≈ 22 %, A4 ≈ 97 % |
| Latência média @ 100 ms cresce A4 < A1 < A2 | A4 ≈ 3 ms, A1 ≈ 32 ms, A2 ≈ 83 ms |
| Em **20 ms**, perdas A1/A2 ≫ A4 | A1/A2 ≈ 78 %, A4 ≈ 2 % |

A **tabela executiva de referência** (com ± 1 σ sobre 3 reps) está em
[`resultados/oficial-2026-06-04-v2/tabelas-artigo/tabela1_comparacao_executiva.csv`](../resultados/oficial-2026-06-04-v2/tabelas-artigo/tabela1_comparacao_executiva.csv).

> Diferenças **quantitativas** de ±10 % em latência e ±5 % em
> throughput são esperadas (depende do PC, do roteador Wi-Fi e da
> distância do ESP32). Diferenças **qualitativas** (mudar a ordem A1
> vs A2 vs A4, por exemplo) indicam problema metodológico — abra uma
> issue.

---

## 9. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `totalReceivedMessages: 0` no `/metrics` | Firewall bloqueando porta 3000 | Liberar a porta no Windows Defender / iptables |
| ESP32 não conecta ao Wi-Fi | Rede 5 GHz (ESP32 só faz 2.4 GHz) | Use a banda 2.4 GHz da sua rede |
| `MQTT broker not responding` | Docker não está rodando | `docker ps` → se vazio, abrir Docker Desktop |
| `vercel dev` pede login interativo | Setup inicial do Vercel CLI | Use `node scripts/run-experiments.mjs --scenarios a3` (usa `dev-server.mjs`) |
| Latências negativas no CSV | SNTP do ESP32 não sincronizou | Veja Serial Monitor → `[sntp] Sincronizado` deve aparecer no boot |
| `missingMessages` > 50 % | ESP32 longe do roteador, sinal fraco | Aproxime o ESP32 (RSSI > -70 dBm) |
| `npm run install:all` falha em Windows | Path muito longo | Habilite long paths: `git config --system core.longpaths true` |
| Testes Python falham | matplotlib backend interativo | `export MPLBACKEND=Agg` antes de rodar |
| Orquestrador trava no `warmup` | ESP32 não está enviando ou intervalo muito curto | Veja log `[orchestrator] warmup ... ` — se demorar >12 s, problema no firmware |

---

## 10. Dúvidas e contato

- **Detalhes metodológicos:** ver [`docs/roteiro-experimentos.md`](roteiro-experimentos.md)
- **Estrutura dos dados coletados:** ver [`docs/metricas-coletadas.md`](metricas-coletadas.md)
- **Bugs ou desvios:** abrir issue em https://github.com/llucaslopes/PFC-1-/issues
