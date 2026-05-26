# Prototipo WebSerial

Arquitetura direta usada no TCC:

```text
Arduino/simulador -> navegador web usando WebSerial
```

Este prototipo serve para comparar a comunicacao direta no navegador com a arquitetura intermediada por backend Node.js.

## Escopo oficial

O trabalho compara experimentalmente apenas:

- WebSerial direto, nesta pasta;
- backend Node.js com REST polling e WebSocket, em `../../arquitetura-arduino-node-api`.

WebBluetooth, WebUSB, serverless e nuvem ficam como tecnologias relacionadas ou trabalhos futuros, nao como arquiteturas implementadas.

## Pergunta-problema

Quais diferencas de desempenho, confiabilidade, taxa de transferencia e adequacao ao tempo real podem ser observadas entre uma arquitetura WebSerial direta e uma arquitetura intermediada por backend Node.js no contexto de monitoramento esportivo em aplicacoes web?

Adicionalmente, quais limitacoes de seguranca podem ser identificadas qualitativamente em cada abordagem?

## Objetivo geral

Comparar experimentalmente duas arquiteturas para coleta e visualizacao de dados simulados de sensores esportivos em aplicacoes web: uma arquitetura direta baseada em WebSerial e uma arquitetura intermediada por backend Node.js com REST polling e WebSocket.

## Contrato CSV

Todas as linhas devem seguir:

```text
seq,send_ms,hr,ax,ay,az
```

Regras:

- `seq`: inteiro positivo;
- `send_ms`: tempo de envio do Arduino por `millis()` ou tempo do simulador;
- `hr`: frequencia cardiaca simulada, entre 40 e 220 bpm;
- `ax`, `ay`, `az`: aceleracao em g, entre -16 e 16;
- saltos em `seq` contam mensagens perdidas;
- linhas fora do formato contam mensagens invalidas.

Importante: o tempo exibido/exportado e **tempo local de processamento no navegador**, nao latencia fim a fim Arduino -> navegador. O relogio `millis()` do Arduino nao esta sincronizado com o computador.

## Rodar

```powershell
cd prototypes\webserial
npm start
```

Abra:

```text
http://localhost:8765/
```

Use **Iniciar simulacao** para testar sem Arduino. Para usar Arduino real, grave o sketch em:

```text
firmware/sketch_sensor_sim/sketch_sensor_sim.ino
```

Depois abra a pagina no Chrome ou Edge desktop e clique em **Conectar serial**.

## Matriz experimental principal

Cada cenario deve ser repetido 3 vezes. Use 60 segundos por repeticao e calcule media e desvio padrao das metricas principais.

| Cenario | Arquitetura | Modo | Fonte | Intervalo | Duracao |
| --- | --- | --- | --- | --- | --- |
| C1 | WebSerial | direto | simulador/Arduino | 100 ms | 60 s |
| C2 | Backend | WebSocket | simulador/Arduino | 100 ms | 60 s |
| C3 | Backend | REST polling | simulador/Arduino | 100 ms | 60 s |
| C4 | WebSerial | direto | simulador/Arduino | 50 ms | 60 s |
| C5 | Backend | WebSocket | simulador/Arduino | 50 ms | 60 s |
| C6 | Backend | REST polling | simulador/Arduino | 50 ms | 60 s |

## Exportacao

Clique em **Exportar** para baixar:

- `sensor-data.csv`: amostras validas com arquitetura, modo, fonte, horario, `seq`, `send_ms`, `hr`, `ax`, `ay`, `az`, magnitude e tempo local de processamento;
- `metrics.csv`: totais e estatisticas agregadas;
- `experiment-summary.json`: configuracao, metricas e notas de interpretacao.

## Metricas

- total de mensagens validas;
- total de mensagens invalidas;
- mensagens perdidas por salto de `seq`;
- mensagens por segundo;
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
