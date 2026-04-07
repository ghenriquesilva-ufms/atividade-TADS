# Internal Proxy Service com Rate Limiting

Servico backend resiliente para consumo de API externa com limite estrito de **1 request por segundo**, suportando burst interno com fila, cache e agendamento.

O proxy abstrai o `Client ID` do fornecedor: clientes internos nao precisam enviar credencial, pois o servico injeta automaticamente o identificador configurado por ambiente.

## Arquitetura

Padroes aplicados:

- **Proxy Pattern**: endpoint interno encapsula e controla acesso ao servico externo.
- **Queue + Scheduler Pattern**: requests internos entram em fila e o scheduler despacha no maximo 1 req/s.
- **Strategy (Retry/Backoff)**: estrategia de retry exponencial para falhas transientes.
- **Adaptive Throttling**: ajusta automaticamente a cadencia quando detecta falha/penalidade/lentidao.

Fluxo principal:

1. cliente interno chama `GET /proxy/score`.
2. sistema tenta responder via cache fresco.
3. sem cache,Isso request entra na fila interna com prioridade e TTL.
4. scheduler processa no ritmo fixo de 1 req/s.
5. chamada ao externo usa timeout e retry limitado.
6. quando ha falha ou sinal de penalidade, o scheduler reduz a taxa temporariamente e suprime retries por uma janela de protecao.
7. resposta atualiza cache e resolve requests pendentes.

## Estrutura do Projeto

```text
internal-proxy-service/
  src/
    config/
      env.js
    core/
      cacheStore.js
      metrics.js
      priorityQueue.js
    routes/
      proxyRoutes.js
      systemRoutes.js
    services/
      externalApiClient.js
      proxyService.js
    utils/
      logger.js
    server.js
    index.js
  tests/
    helpers/
      mockExternalApi.js
    proxy.integration.test.js
  mock-external/
    index.js
  .env.example
  Dockerfile
  docker-compose.yml
  package.json
  README.md
```

## Endpoints

### `GET /proxy/score`

Encaminha para API externa via logica de proxy.

Headers opcionais:

- `x-priority`: `high`, `normal`, `low`
- `x-ttl-ms`: TTL da request na fila em milissegundos

Resposta:

```json
{
  "ok": true,
  "source": "external",
  "reason": null,
  "data": {
    "score": 100
  }
}
```

### `GET /metrics`

Retorna metricas operacionais:

- total de requests
- total enfileirado
- tamanho da fila
- tamanho maximo de fila observado
- taxa de enfileiramento por segundo
- latencia media
- latencia p50/p95/p99
- taxa de erro
- cache hits
- drops totais e por motivo
- retries
- estado do controle adaptativo (intervalo atual, cooldown, supressao de retry)

### `GET /health`

Retorna status de saude do servico.

## Configuracao

Copie `.env.example` para `.env` e ajuste conforme necessario.

Variaveis principais:

- `DISPATCH_INTERVAL_MS=1000` (limite estrito 1 req/s)
- `EXTERNAL_CLIENT_ID` (obrigatorio para o proxy funcionar)
- `EXTERNAL_CLIENT_ID_PARAM_NAME` (padrao: `client_id`)
- `ADAPTIVE_MAX_DISPATCH_INTERVAL_MS`
- `ADAPTIVE_STEP_MS`
- `ADAPTIVE_COOLDOWN_MS`
- `RETRY_SUPPRESSION_WINDOW_MS`
- `PENALTY_SIGNAL_THRESHOLD_MS`
- `MAX_QUEUE_SIZE`
- `REQUEST_TTL_MS`
- `CACHE_TTL_MS`
- `EXTERNAL_TIMEOUT_MS`
- `RETRY_MAX_ATTEMPTS`

## Como Executar (Local)

1. Instalar dependencias:

```bash
npm install
```

2. Subir API externa simulada:

```bash
node mock-external/index.js
```

3. Em outro terminal, subir proxy:

```bash
npm start
```

## Como Executar com Docker

```bash
docker compose up --build
```

Servicos:

- Proxy: `http://localhost:3000`
- Externo simulado: `http://localhost:4001`

## Exemplos de Uso

```bash
curl "http://localhost:3000/proxy/score?userId=123"
```

```bash
curl -H "x-priority: high" -H "x-ttl-ms: 5000" "http://localhost:3000/proxy/score?userId=999"
```

```bash
curl "http://localhost:3000/metrics"
```

```bash
curl "http://localhost:3000/health"
```

## Testes Automatizados

A suite valida os cenarios:

1. Burst de 20 requests em 1 segundo.
2. Penalidade por abuso direto e prevencao via proxy.
3. API externa lenta com uso de cache e retry limitado.
4. Politica de fila com prioridade e expiracao por TTL.
5. Controle adaptativo de cadencia com janela de protecao.
6. Observabilidade com percentis de latencia e metricas de fila.

Rodar testes:

```bash
npm test
```

## Decisoes Tecnicas

- **Fila interna obrigatoria** para absorver picos sem violar contrato externo.
- **Scheduler fixo de 1 req/s** para estabilidade e previsibilidade.
- **Cache com stale** para resiliência quando o externo falha.
- **Deduplicacao por chave de request** para evitar chamadas externas duplicadas em concorrencia.
- **Metricas operacionais** para observabilidade e tuning de capacidade.

## Relato Tecnico Curto

### Padroes adotados

- Proxy: encapsula o upstream e centraliza credencial (`Client ID`) no servidor.
- Queue + Scheduler: desacopla pico interno da taxa externa limitada.
- Strategy: retry com backoff e supressao por janela de protecao.
- Adaptive Throttling: ajuste automatico da cadencia apos sinais de falha/penalidade.

### Padroes considerados e rejeitados

- Circuit Breaker completo: rejeitado neste ciclo para manter escopo e simplicidade operacional; o controle adaptativo e a supressao de retry ja mitigam cascata de falhas.
- Persistencia de fila em banco/redis: rejeitada para o MVP por custo operacional maior; para producao com alta disponibilidade, e recomendada.

### Experimentos (resultados de testes)

- Burst 20 req/1s: fila absorve pico, upstream mantem cadencia proxima de 1 req/s, sem penalidade recorrente.
- Penalidade proposital no upstream: abuso direto gera penalidade; via proxy, mesma carga nao dispara penalidade.
- Timeout/5xx: fallback de cache quando disponivel, retries limitados e supressao temporaria para evitar tempestade de tentativas.
- Politica de fila: prioridade respeitada e TTL expirado descartado com motivo.
- Observabilidade: metricas exibem taxa de enfileiramento, maximo de fila, latencias percentis, retries e quedas por politica.

### Trade-offs

- Throughput previsivel foi priorizado sobre menor latencia instantanea em picos.
- Cache stale melhora disponibilidade, com risco controlado de dados menos recentes.
- Sem persistencia de fila, reinicio do processo pode perder requests pendentes.

### Interface e compatibilidade

- O endpoint interno principal (`/proxy/score`) preserva parametros funcionais da chamada de score para o upstream.
- A diferenca intencional e somente a abstracao da credencial (`Client ID`), que e gerenciada internamente via ambiente.
