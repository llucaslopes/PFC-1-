# Prototipo WebSerial — APENAS HISTORICO / TRABALHO ANTERIOR

> **AVISO:** este diretorio contem material de uma **versao anterior**
> do PFC-1, em que o tema do TCC era "WebSerial direto vs backend Node".
> O tema atual mudou para "comparacao de padroes de comunicacao IoT
> (REST polling, WebSocket, MQTT) com ESP32 + Wi-Fi", e WebSerial **nao
> faz mais parte do escopo experimental**. Esta pasta esta preservada
> apenas como referencia da versao anterior do trabalho. Nada aqui e
> executado pela campanha oficial atual em `scripts/run-experiments.mjs`.

Versao antiga do prototipo:

```text
Arduino/simulador -> navegador web usando WebSerial
```

Servia para comparar a comunicacao direta no navegador com a arquitetura
intermediada por backend Node.js. **Nao usar mais como referencia para
o TCC atual.**

## Escopo do TCC atual (referencia rapida)

O TCC atual compara tres padroes de comunicacao principais:

- **REST polling** (Backend Node, prefixo vazio).
- **WebSocket** (Backend Node, broadcast).
- **MQTT / Pub-Sub** (broker Mosquitto + bridge Node).

Mais a subsecao complementar **Serverless** (Vercel Functions). Veja
`README.md` na raiz do repositorio para o escopo completo.

WebSerial, WebBluetooth e WebUSB ficam como tecnologias relacionadas /
trabalho anterior, nao como padroes implementados.

## Pergunta-problema

Quais diferencas de desempenho, confiabilidade, taxa de transferencia e adequacao ao tempo real podem ser observadas entre uma arquitetura WebSerial direta e uma arquitetura intermediada por backend Node.js no contexto de monitoramento esportivo em aplicacoes web?

Adicionalmente, quais limitacoes de seguranca podem ser identificadas qualitativamente em cada abordagem?

## Objetivo geral

Comparar experimentalmente duas arquiteturas para coleta e visualizacao de dados simulados de sensores esportivos em aplicacoes web: uma arquitetura direta baseada em WebSerial e uma arquitetura intermediada por backend Node.js com REST polling e WebSocket.

## Contrato CSV

Todas as linhas devem seguir:

```text
seq,send_us,hr,ax,ay,az
```

Regras:

- `seq`: inteiro positivo;
- `send_us`: instante de envio em microssegundos (`micros()` no Arduino ou equivalente no simulador);
- `hr`: frequencia cardiaca simulada, entre 40 e 220 bpm;
- `ax`, `ay`, `az`: aceleracao em g, entre -16 e 16;
- saltos em `seq` contam mensagens perdidas;
- linhas fora do formato contam mensagens invalidas.

Importante: a latencia fim a fim e estimada por sincronizacao NTP/Cristian entre Arduino e navegador (`SYNC,<client_t0>` / `SYNC_REPLY`), com incerteza documentada. Sem SYNC, usa fallback relativo. Ver `docs/roteiro-experimentos.md`.

## Rodar

```powershell
cd prototypes\webserial
npm start
```

Abra:

```text
http://localhost:8765/
```

Use **Iniciar simulacao** para testar sem Arduino. Para usar Arduino real, grave o sketch canonico centralizado em:

```text
../../arduino/tcc_sports_sensor_standard/tcc_sports_sensor_standard.ino
```

Depois abra a pagina no Chrome ou Edge desktop e clique em **Conectar serial**.

## Matriz experimental principal

Cada cenario deve ser repetido 3 vezes. Use 60 segundos por repeticao e calcule media e desvio padrao das metricas principais. A opcao **Campanha stress** executa automaticamente `100, 50, 20, 10, 5 e 1 ms`.

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| C1 | WebSerial | direto | simulador/Arduino | 100, 50, 20, 10, 5, 1 ms | 60 s |
| C2 | Backend | WebSocket | simulador/Arduino | 100, 50, 20, 10, 5, 1 ms | 60 s |
| C3 | Backend | REST polling | simulador/Arduino | 100, 50, 20, 10, 5, 1 ms | 60 s |

## Exportacao

Clique em **Exportar** para baixar:

- `sensor-data.csv`: amostras validas com arquitetura, modo, fonte, horario, `seq`, `send_ms`, `hr`, `ax`, `ay`, `az`, magnitude e tempo local de processamento;
- `metrics.csv`: uma linha por execucao/intervalo com mensagens esperadas, recebidas, ausentes, lacunas de sequencia, throughput e latencia estimada;
- `campaign-summary.csv`: uma linha por intervalo da campanha, pronta para graficos;
- `experiment-summary.json`: configuracao, metricas e notas de interpretacao.

## Metricas

- total de mensagens validas;
- total de mensagens invalidas;
- mensagens ausentes (`missing_messages`) calculadas por esperado menos recebido;
- lacunas de sequencia (`sequence_gap_messages`) como diagnostico auxiliar;
- mensagens por segundo;
- throughput percentual;
- latencia fim a fim estimada (`end_to_end_latency_ms`) com offset sincronizado e incerteza; nao e medicao fisica absoluta;
- percentual de perdas;
- percentual de invalidas;
- media, minimo, maximo e desvio padrao do tempo local de processamento;
- estatisticas de frequencia cardiaca e aceleracao.

## Analise qualitativa de seguranca

| Criterio | WebSerial | Backend Node.js |
| --- | --- | --- |
| Permissao do usuario | Exige autorizacao explicita no navegador | Nao acessa o dispositivo diretamente pelo navegador |
| Exposicao em rede | Baixa, uso local | Maior, backend expoe endpoints HTTP e WebSocket |
| Compatibilidade | Limitada a navegadores com WebSerial | Mais ampla para clientes web |
| Autenticacao | Nao aplicavel no prototipo | Nao implementada |
| Risco principal | Acesso fisico/local ao dispositivo | Endpoints abertos, CORS e WebSocket sem autenticacao |

## Interpretacao

WebSerial tende a ser simples e direto para testes locais com um unico navegador conectado ao Arduino. A limitacao principal e depender de navegador compativel, permissao do usuario e conexao fisica local. Para multiplos consumidores, historico centralizado ou integracao com outros servicos, a arquitetura com backend tende a ser mais organizada.
