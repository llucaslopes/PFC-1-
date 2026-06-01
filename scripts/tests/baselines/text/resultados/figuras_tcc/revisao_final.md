# Revisao final – Cobertura, ordem e recomendacoes

## 1. Comentarios do orientador (lista de checagem)

A lista abaixo mapeia cada comentario tipico do orientador a figuras que
o respondem diretamente. Ajuste conforme o feedback exato recebido.

| Demanda do orientador                                                                  | Figuras que respondem      | Tabela de apoio |
|----------------------------------------------------------------------------------------|----------------------------|-----------------|
| Mostrar quando cada arquitetura "quebra" sob taxa crescente                            | 01, 02 + linhas verticais  | Tabela 1, 2     |
| Quantificar latencia (media e cauda)                                                    | 03, 04                     | Tabela 1        |
| Comparar arquiteturas em pontos comparaveis                                             | 01-04 (mesmo X)            | Tabela 5        |
| Custo do backend ao escalar clientes                                                    | 07, 08                     | Tabela 4        |
| Justica entre clientes / fairness                                                       | 06, (CV em Tabela 3)       | Tabela 3        |
| Diferenca entre throughput agregado e por cliente em WS vs REST                         | 05, 06, 11                 | Tabela 3        |
| Validar que os dados sao reais (sem invencao)                                           | Todas; CSVs sao a fonte    | Todas           |
| Diagrama da arquitetura testada                                                         | A, B, C                    | –          |
| Como a latencia e medida                                                                | D                          | –          |
| Como o experimento multi-cliente foi conduzido                                          | E                          | –          |
| Visao geral do ambiente / reprodutibilidade                                             | F                          | –          |

## 2. Figuras OBRIGATORIAS (no corpo do artigo)

| Ordem | Arquivo                                              | Conteudo                                                |
|------:|------------------------------------------------------|---------------------------------------------------------|
| 1     | `diagramas/F_ambiente_experimental.{png|svg}`        | Visao geral do ambiente (introducao/metodo)             |
| 2     | `diagramas/A_arquitetura_webserial.{png|svg}`        | Arquitetura C1 (na secao de metodo)                     |
| 3     | `diagramas/B_arquitetura_websocket.{png|svg}`        | Arquitetura C2 (na secao de metodo)                     |
| 4     | `diagramas/C_arquitetura_rest_polling.{png|svg}`     | Arquitetura C3 (na secao de metodo)                     |
| 5     | `diagramas/D_fluxo_medicao_latencia.{png|svg}`       | Como a latencia e medida (metodo)                       |
| 6     | `png/fig01_throughput_vs_intervalo.png`              | Resultado central da campanha vertical                  |
| 7     | `png/fig02_perda_vs_intervalo.png`                   | Resultado central de perdas                             |
| 8     | `png/fig03_latencia_media_vs_intervalo.png`          | Latencia media x carga                                  |
| 9     | `png/fig04_latencia_p95_vs_intervalo.png`            | Latencia P95 x carga                                    |
| 10    | `diagramas/E_cenario_multi_cliente.{png|svg}`        | Setup multi-cliente (metodo da Parte 2)                 |
| 11    | `png/fig05_throughput_por_clientes.png`              | Resultado central da campanha horizontal                |
| 12    | `png/fig07_cpu_por_clientes.png`                     | Custo do backend                                        |
| 13    | `png/fig09_latencia_media_por_clientes.png`          | Latencia x N (resposta direta a "escala")               |

## 3. Figuras OPCIONAIS (apendice ou versao expandida)

| Arquivo                                              | Justificativa de opcionalidade                              |
|------------------------------------------------------|-------------------------------------------------------------|
| `png/fig06_throughput_por_cliente.png`               | Complementa 05 (mesma historia em outra metrica)            |
| `png/fig08_memoria_por_clientes.png`                 | Memoria varia muito pouco – vai ao apendice            |
| `png/fig10_latencia_p95_por_clientes.png`            | Reforca a Fig. 09; opcional se houver limite de paginas     |
| `png/fig11_cobertura_unica_websocket.png`            | Resultado positivo trivial em WS; util como sanidade        |

## 4. Ordem recomendada das figuras dentro do artigo

```
[Introducao]
  Figura F   - ambiente experimental completo (orienta o leitor)
[Metodo]
  Figura A   - arquitetura C1 WebSerial
  Figura B   - arquitetura C2 WebSocket
  Figura C   - arquitetura C3 REST polling
  Figura D   - fluxo de medicao da latencia
[Resultados - escalabilidade vertical]
  Figura 01  - throughput x intervalo  (com pontos de stress)
  Figura 02  - perdas x intervalo
  Figura 03  - latencia media x intervalo
  Figura 04  - latencia P95 x intervalo
  Tabela 1   - resumo por (arquitetura, intervalo)
  Tabela 2   - pontos de stress
[Resultados - escalabilidade horizontal]
  Figura E   - cenario multi-cliente (metodo dessa parte)
  Figura 05  - throughput agregado x N
  Figura 07  - CPU do backend x N
  Figura 09  - latencia media x N
  Tabela 3   - resumo horizontal
  Tabela 4   - uso de recursos
[Discussao / Sintese]
  Tabela 5   - comparacao final entre arquiteturas
[Apendice]
  Figura 06, 08, 10, 11  - figuras complementares
```

## 5. Figuras para os SLIDES da banca

Selecao enxuta para 12-15 minutos de apresentacao:

1. **Figura F** – contexto inicial.
2. **Figuras A, B, C combinadas** (1 slide com os 3 diagramas lado a lado).
3. **Figura D** – 1 slide explicando a medicao de latencia.
4. **Figura 01** – resposta principal sobre escalabilidade vertical.
5. **Figura 02** – perdas (apoio direto a Figura 01).
6. **Figura 04** – latencia P95 (resposta sobre experiencia do usuario).
7. **Figura E** – setup multi-cliente.
8. **Figura 05** – throughput agregado x N (resposta principal Parte 2).
9. **Figura 07** – CPU x N (custo).
10. **Figura 09** – latencia media x N.
11. **Tabela 5** – comparacao final como slide de fechamento.

## 6. Limitacoes que devem ser citadas junto com as figuras

1. **Latencia e estimativa**, nao medicao fisica. Calculada por
   sincronizacao de relogio NTP-style (`scripts/lib/clock-sync.mjs` e
   `clockSyncMath.{ts,js,mjs}`). Incerteza por amostra ~ `RTT_sync / 2`.
2. **Throughput agregado WebSocket vs REST nao e diretamente comparavel**:
   WebSocket replica a mesma amostra para N clientes (broadcast); REST
   polling devolve respostas HTTP a cada cliente, podendo repetir
   amostras (ver `throughput_aggregate_type` no consolidado).
3. **WebSerial nao suporta multiplos clientes**: aparece apenas em N=1
   como baseline arquitetural; a Web Serial API e exclusiva por porta.
4. **Duas execucoes multi-cliente foram afetadas por rollover do
   `micros()` do Arduino** (`rest-polling_5ms_5cli_rep3`,
   `websocket_5ms_5cli_rep3`); latencia dessas linhas foi anulada antes
   das figuras 09 e 10. Throughput, perdas e recursos dessas execucoes
   foram preservados.
5. **REST Polling em intervalos grandes (>=50 ms)** usa polling de 1 ms
   no cliente; a "latencia estimada" reflete o atraso do polling.
6. **Localhost com USB serial local**: nao generaliza para infraestrutura
   distribuida (sem rede entre componentes).

## 7. Resumo do pipeline de reproducao

```powershell
# (a) Re-rodar campanha vertical (opcional):
node scripts/run-scalability-campaign.mjs

# (b) Re-rodar campanha horizontal (opcional):
node scripts/run-multiclient-scalability.mjs

# (c) Re-consolidar metricas:
python scripts/consolidate_results.py
python scripts/scalability_metrics.py resultados/escalabilidade-2026-05

# (d) Aplicar correcoes (rollover):
node scripts/fix-rollover-anomalies.mjs

# (e) Gerar este pacote (figuras + tabelas + diagramas + textos):
python scripts/gera_figuras_tcc.py
```

Todas as figuras, tabelas e diagramas deste pacote sao geradas por
`scripts/gera_figuras_tcc.py` exclusivamente a partir de
`consolidated_metrics.csv` (campanha vertical) e
`consolidated_metrics_corrected.csv` (campanha horizontal corrigida),
sem nenhum dado sintetico.
