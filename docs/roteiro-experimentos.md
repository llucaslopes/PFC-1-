# Roteiro de Experimentos

Este roteiro padroniza a execucao dos testes do TCC para comparar WebSerial direto e backend Node.js com REST polling/WebSocket.

## 1. Preparacao

Instale as dependencias:

```powershell
npm run install:all
```

Use o Arduino como fonte principal da campanha experimental. O simulador deve ser usado como fonte auxiliar para ensaios reprodutiveis, depuracao e comparacao controlada, sempre identificado no campo `source`.

## 2. Iniciar as arquiteturas

Backend Node.js:

```powershell
cd arquitetura-arduino-node-api\backend
npm run dev
```

Dashboard:

```text
http://localhost:3000
```

WebSerial:

```powershell
cd prototypes\webserial
npm start
```

Dashboard:

```text
http://localhost:8765/
```

## 3. Fonte dos dados

Simulador:

- Backend: configure `SENSOR_SOURCE=simulator`. O intervalo real do simulador e atualizado por `sendIntervalMs` ao iniciar o experimento.
- WebSerial: clique em **Iniciar simulacao** antes de executar o experimento.

Arduino:

- Grave o sketch padrao centralizado em `arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino`.
- Use baud rate `115200`.
- No backend, configure `SENSOR_SOURCE=serial` e `SERIAL_PORT=COM3` ou a porta equivalente.
- No WebSerial, clique em **Conectar serial** e selecione a porta autorizada pelo navegador.

## 4. Matriz principal

Execute cada cenario 3 vezes, sempre com duracao de 60 segundos. Use a opcao **Campanha stress** para rodar automaticamente os intervalos `100, 50, 20, 10, 5 e 1 ms` na arquitetura/modo selecionado.

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| C1 | WebSerial | direto | Arduino principal / simulador auxiliar | 100, 50, 20, 10, 5, 1 ms | 60 s |
| C2 | Backend Node.js | WebSocket | Arduino principal / simulador auxiliar | 100, 50, 20, 10, 5, 1 ms | 60 s |
| C3 | Backend Node.js | REST polling | Arduino principal / simulador auxiliar | 100, 50, 20, 10, 5, 1 ms | 60 s |

Total principal esperado: 3 arquiteturas/modos x 6 intervalos x 3 repeticoes = 54 execucoes por fonte.

## 5. Execucao

Para cada repeticao:

1. Selecione fonte, modo e duracao.
2. Clique em **Campanha stress** para executar todos os intervalos.
3. Aguarde a conclusao automatica da campanha.
4. Informe o numero da repeticao no campo **Repeticao**.
5. Clique em **Exportar**.

Os nomes sao gerados automaticamente neste padrao:

```text
<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_<data>_sensor-data.csv
<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_<data>_metrics.csv
<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_<data>_campaign-summary.csv
<arquitetura>_<modo>_<fonte>_<intervalo>ms_rep<numero>_<data>_experiment-summary.json
```

Exemplo:

```text
backend-node_websocket_serial_100ms_rep1_2026-05-29T10-00-00-000Z_metrics.csv
```

## 6. Medicao de latencia fim a fim (estimada)

A latencia ponta a ponta mede o tempo entre o instante em que o Arduino gera/envia uma amostra (`send_us` via `micros()`) e o instante em que o frontend observa a mensagem (`frontend_receive_ms` via `performance.now()`).

Como Arduino, backend e navegador usam relogios independentes, o sistema executa sincronizacao estilo NTP/Cristian antes de cada experimento:

1. **WebSerial:** quatro timestamps (`t0` envio SYNC, `t1`/`t2` `micros()` no Arduino, `t3` recebimento da resposta). A melhor amostra entre 10 tentativas e a de menor RTT.
2. **Backend + frontend:** cadeia em dois elos — Arduino↔backend (serial) e backend↔frontend (`POST /clock/sync`).
3. **REST polling:** mesma estimativa no frontend, mas `frontend_receive_ms` e o instante da **primeira** observacao de cada `seq` (deduplicacao evita inflar latencia ao repetir a ultima amostra).

**Convencao de offset:** `hostMs = remoteMs + offsetMs`. A latencia estimada por amostra e:

```text
end_to_end_latency_ms = frontend_receive_ms - estimated_frontend_send_ms
```

**Incerteza:** limitada aproximadamente por `RTT_sync / 2` em cada elo; no backend soma-se `incerteza_Arduino↔backend + incerteza_backend↔frontend`. Isso nao e margem de erro estatistica completa — e um limite superior da assimetria de ida/volta na sincronizacao.

**Quando confiar na medicao:**

- SYNC concluido sem fallback (`syncFailed: false`).
- RTT de sincronizacao baixo e estavel (idealmente &lt; 5 ms em USB serial local).
- Intervalo de envio nao tao agressivo que cause fila serial ou perdas (`throughput_percent` proximo de 100%).

**Fallback:** sem SYNC valido, o sistema marca `latency_method` como baseline relativo e nao deve ser comparado numericamente entre maquinas diferentes.

**Validacao fisica absoluta:** exigiria instrumentacao externa (analiseador logico, osciloscopio) acoplada ao pino de envio serial e ao evento de recebimento no host.

## 7. Interpretacao dos CSVs

Use `metrics.csv` para tabelas comparativas:

- `expected_messages`: mensagens esperadas pelo intervalo e duracao configurados.
- `received_messages`: mensagens validas recebidas durante o experimento.
- `missing_messages`: perdas experimentais principais, calculadas por esperado menos recebido.
- `sequence_gap_messages`: perdas detectadas por salto de `seq`, mantidas como diagnostico.
- `throughput_percent`: percentual recebido em relacao ao esperado.
- `messages_per_second`: throughput medio.
- `estimated_latency_*_ms`: estatisticas da latencia fim a fim estimada (`end_to_end_latency_ms`).
- `uncertainty_*_ms`: estatisticas da incerteza de sincronizacao por amostra (`clock_uncertainty_ms`).
- `replication_number`, `environment` e `application_version`: contexto operacional para rastreabilidade da execucao.

Use `campaign-summary.csv` para graficos:

- Throughput x intervalo.
- Latencia estimada media x intervalo.
- Perdas experimentais (`missing_messages`) x intervalo.
- Comparacao entre arquiteturas apos consolidar os CSVs de cada campanha.

Use `sensor-data.csv` para analises por amostra:

- verificar estabilidade da frequencia de chegada;
- procurar saltos de `seq`;
- inspecionar `end_to_end_latency_ms`, `estimated_frontend_send_ms`, `clock_offset_ms`, `clock_uncertainty_ms` e `latency_method`;
- observar variacao de frequencia cardiaca (`hr`, `ax`, `ay`, `az`).

Use `experiment-summary.json` para registrar configuracao, blocos `latency`, `clockSync`, `limitations` e notas de interpretacao.
Em campanhas, o JSON separa `campaign`, `runs`, `saturationAnalysis` e `saturation`, evitando misturar o ultimo experimento com o primeiro resumo estatistico.

## 8. Consolidacao e graficos

Coloque todos os CSVs exportados em `resultados/` e execute:

```powershell
python scripts/consolidate_results.py resultados
python scripts/plot_results.py resultados
```

O primeiro comando gera `resultados/consolidated_metrics.csv`. O segundo gera graficos em `resultados/plots/` para:

- throughput x intervalo;
- latencia media estimada x intervalo;
- latencia p95 estimada x intervalo;
- perdas x intervalo.

## 9. Roteiro de analise para o TCC

Para cada arquitetura/modo, compare:

- throughput x intervalo;
- latencia media estimada x intervalo;
- latencia p95 estimada x intervalo;
- perdas x intervalo;
- ponto de saturacao;
- limite operacional recomendado.

Exemplo de conclusao: a arquitetura WebSocket manteve throughput acima de 95% ate determinado intervalo, mas apresentou degradacao apos o ponto de saturacao. REST polling pode limitar antes por perder atualizacoes entre requisicoes. WebSerial reduz o caminho de comunicacao, mas depende diretamente do navegador e da maquina conectada ao Arduino.

## 10. Avaliacao minima de escalabilidade

Com o backend rodando, execute:

```powershell
cd arquitetura-arduino-node-api\backend
npm run test:scale
```

O script testa REST polling e WebSocket com 1, 5 e 10 clientes simulados. Ele gera um CSV com:

- modo de comunicacao;
- quantidade de clientes;
- duracao;
- total de mensagens observadas;
- mensagens por segundo;
- perdas detectadas por salto de `seq`;
- erros de requisicao ou conexao.

Use esses resultados como avaliacao controlada de escalabilidade, sem afirmar comportamento em producao ou infraestrutura distribuida.

## 11. Cuidados na defesa

- Declarar que a latencia fim a fim e uma **estimativa** de one-way latency via sincronizacao de relogio, com incerteza documentada — nao uma medicao fisica absoluta.
- Explicar que seguranca e tratada qualitativamente porque o prototipo nao implementa TLS, autenticacao ou autorizacao.
- Explicar que WebBluetooth, WebUSB, serverless e nuvem foram retirados do escopo experimental e permanecem como trabalhos futuros.

## 12. Execucao automatizada

Como alternativa a execucao manual, ha um orquestrador em `scripts/run-experiments.mjs` que automatiza toda a matriz da secao 4. Em uma unica chamada ele:

1. Detecta a porta COM do Arduino sozinho (procura dispositivos PnP do tipo Arduino / CH340 / CP210x / FTDI).
2. Impede o Windows de dormir pelo `SetThreadExecutionState` (via processo filho de PowerShell que e morto no fim).
3. Para cada fonte (`serial` e depois `simulator`), e para cada cenario (`c1`, `c2`, `c3`):
   - Sobe o servidor correspondente (WebSerial em `:8765` ou backend em `:3000`).
   - Para C1, abre um Chromium controlado por Playwright; se a porta serial ainda nao foi autorizada no perfil persistente, faz o bootstrap automaticamente e segue assim que detectar a permissao. Depois clica em **Conectar serial**/**Iniciar simulacao**, **Campanha stress** e **Exportar**, salvando os 4 arquivos em `resultados/`.
   - Para C2 (WebSocket) e C3 (REST polling), age como um cliente Node: sincroniza o relogio (`POST /clock/sync` x 10), inicia o experimento, observa via WebSocket ou polling, envia as observacoes e grava os 4 arquivos por repeticao.
   - Resume automatico: pula reps cujos arquivos ja existem em `resultados/`.
   - Continua apos falha de uma rep individual em vez de abortar tudo.
   - Heartbeat a cada 10 s no log mostrando rep atual, intervalo, mensagens recebidas etc.
4. Ao final, roda `scripts/consolidate_results.py` e `scripts/plot_results.py`.
5. Restaura o estado de sleep do Windows.

Como Arduino e servidor backend nao podem usar a mesma porta serial simultaneamente, o orquestrador alterna entre eles.

### Preparacao (uma vez por maquina)

```powershell
npm install
npx playwright install chromium
```

### Execucao totalmente automatica

Plugue o Arduino e rode:

```powershell
node scripts/run-experiments.mjs
```

Equivale a `--sources serial,simulator --reps 3 --duration 60 --scenarios c1,c2,c3`. Se for a primeira execucao da maquina, o Chromium abre durante o C1/serial e voce so precisa clicar em **Conectar serial** uma unica vez — o script detecta a permissao e segue. Nas execucoes seguintes nem isso e necessario.

### Variacoes comuns

```powershell
# So simulador (nao precisa de Arduino plugado)
node scripts/run-experiments.mjs --sources simulator --reps 3

# So backend (C2 e C3) com 5 reps
node scripts/run-experiments.mjs --scenarios c2,c3 --reps 5

# Porta serial fixa em vez de auto
node scripts/run-experiments.mjs --serial-port COM3

# Autorizar a porta serial uma vez sem rodar nada (modo bootstrap puro)
node scripts/run-experiments.mjs --bootstrap-webserial
```

### Opcoes uteis

| Flag | Default | Descricao |
| --- | --- | --- |
| `--sources` | `serial,simulator` | Lista de fontes a rodar em sequencia. |
| `--source` | (vazio) | Atalho para uma unica fonte (sobrescreve `--sources`). |
| `--serial-port` | `auto` (env `SERIAL_PORT`) | Porta COM do Arduino; `auto` detecta sozinho. |
| `--reps` | `3` | Numero de repeticoes por cenario. |
| `--duration` | `60` | Duracao em segundos por intervalo. |
| `--intervals` | `100,50,20,10,5,1` | Intervalos da campanha stress (ms). |
| `--scenarios` | `c1,c2,c3` | Quais cenarios executar (subset separado por virgula). |
| `--results-dir` | `resultados` | Diretorio de saida dos CSV/JSON. |
| `--port-backend` | `3000` | Porta do backend Node.js. |
| `--port-webserial` | `8765` | Porta do servidor estatico do WebSerial. |
| `--chromium-user-data` | `.playwright-profile` | Diretorio do perfil persistente do Chromium. |
| `--log-file` | desligada | Tee de stdout/stderr para arquivo (`logs/overnight.log` por exemplo). |
| `--heartbeat-ms` | `10000` | Intervalo (ms) do log de heartbeat durante a observacao. |
| `--no-resume` | desligada | Roda mesmo se ja existem arquivos para a rep (sem isso, reps completas sao puladas). |
| `--no-continue-on-error` | desligada | Aborta tudo na primeira falha (sem isso, segue para a proxima rep/cenario). |
| `--no-keep-awake` | desligada | Nao impede o Windows de dormir durante o run. |
| `--no-auto-bootstrap` | desligada | Nao abre o Chrome para autorizar a porta serial automaticamente. |
| `--skip-analysis` | desligada | Pula o `consolidate_results.py` + `plot_results.py` no fim. |
| `--bootstrap-webserial` | desligada | Modo de autorizacao inicial da porta serial e sai. |

### Saidas

Os nomes dos arquivos seguem exatamente o mesmo padrao do export manual:

```text
backend-node_websocket_serial_100ms_rep1_<timestamp>_metrics.csv
backend-node_websocket_serial_1ms_rep1_<timestamp>_campaign-summary.csv
webserial_webserial_serial_1ms_rep2_<timestamp>_experiment-summary.json
```

### Estimativa de duracao

6 intervalos x 60 s x 3 repeticoes x 3 cenarios ≈ **60 a 70 min por fonte**, sem contar overhead de start/stop dos servidores. Total Arduino + Simulador ≈ **2,5 h** rodando sem assistencia (apos o bootstrap inicial).

### Limitacoes da automacao

- A primeira execucao do WebSerial exige autorizacao manual da porta serial (limitacao da Web Serial API).
- O Chromium fica em modo headed durante a campanha C1, pois alguns sistemas bloqueiam Web Serial em headless.
- Se o `POST /clock/sync` ou o handshake serial/Arduino falhar, o orquestrador grava `latencyMethod = relative_offset_*` exatamente como o frontend faz hoje — mantendo a rastreabilidade cientifica.

### Resiliencia para campanhas longas (overnight)

Todas as protecoes abaixo estao ligadas por padrao — basta rodar `node scripts/run-experiments.mjs` que ja vale para uma noite inteira:

1. **Keep-awake automatico** — o orquestrador chama `SetThreadExecutionState` (via processo filho de PowerShell) com `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED`. O Windows para de dormir enquanto o run roda e volta ao normal quando o script sai (mesmo se voce der Ctrl+C). Use `--no-keep-awake` para desligar.
2. **Auto-deteccao da porta serial** — `--serial-port auto` (default) procura via Win32_PnPEntity um dispositivo Arduino / CH340 / CP210x / FTDI e usa a primeira COM correspondente.
3. **Auto-bootstrap do WebSerial** — se a permissao da porta nao estiver no perfil, o Chrome abre, voce clica em **Conectar serial** uma unica vez, e o script segue automaticamente.
4. **Resume automatico** — varre `resultados/` antes de cada rep e pula as que ja tem `experiment-summary.json`. Reiniciou no meio? Continua de onde parou.
5. **Continuar apos falha** — se uma rep individual falhar (perda de USB, timeout, crash do servidor), a falha e logada e o orquestrador segue para a proxima rep / cenario / fonte.
6. **Heartbeat** — durante cada observacao, uma linha tipo `[heartbeat 2026-05-30T03:14:00] backend-rest-polling rep=2/3 intervalIdx=4/6 intervalMs=20ms received=2412 expected=3000` aparece a cada 10 s.
7. **Log em arquivo** — `--log-file logs/overnight.log` faz tee de stdout/stderr para arquivo.

Receita pronta para a madrugada:

```powershell
mkdir logs -ErrorAction SilentlyContinue
node scripts/run-experiments.mjs --log-file logs/overnight.log
```

Pronto. Ele detecta a porta, autoriza o WebSerial se precisar, roda C1+C2+C3 com Arduino, depois roda C1+C2+C3 com simulador, gera o consolidado e os graficos. Se travar em algum ponto, basta rodar o mesmo comando de novo: o resume pula tudo que ja deu certo. Para forcar refazer, use `--no-resume`.
