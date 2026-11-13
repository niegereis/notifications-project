# Teste de carga (k6)

Mede quantas notificações por segundo a API aceita e quanto tempo o worker leva
para entregá-las. O script é `k6/post-notifications.js`.

## Antes de rodar: o rate limit

O limite é por **canal + destinatário** (`RATE_LIMIT_MAX`, default 10 por 60s). O
script usa um destinatário novo a cada requisição, então o limite não é atingido.
Mesmo assim, se aparecer `notifications_rate_limited > 0`, o teste está medindo
o Redis devolvendo 429, não a capacidade do sistema.

Os provedores rodam **simulados** (sem credenciais Twilio/FCM) e o e-mail vai
para o Mailpit. Isso é o desejado: o teste não deve chamar serviço externo.

## Rodar

Smoke (10s a 5 req/s, confirma que o script e a chave funcionam):

```bash
LOADTEST_SMOKE=1 docker compose --profile loadtest run --rm k6
```

Rampa completa (50, 200, 500 e 1000 req/s, ~5 min):

```bash
docker compose --profile loadtest run --rm k6
```

Rampa sem inundar o terminal e com o resumo salvo em `loadtest/results/`
(ignorado pelo git). Argumentos depois do nome do serviço **substituem** o
`command` do compose, então repita `run` e o caminho do script:

```bash
mkdir -p loadtest/results
docker compose --profile loadtest run --rm k6 run --quiet --log-output=none \
  --summary-export=/results/rodada-1.json /scripts/post-notifications.js
```

Ajustes pelo `.env` ou inline:

| Variável | Default | Efeito |
| --- | --- | --- |
| `LOADTEST_TARGETS` | `50,200,500,1000` | degraus de req/s |
| `LOADTEST_STAGE_DURATION` | `1m` | tempo segurando cada degrau |
| `LOADTEST_E2E_RATE` | `2` | notificações/s que acompanham o desfecho (0 desliga) |
| `LOADTEST_API_KEY` | `PANEL_API_KEY` | chave do serviço chamador |

Com k6 instalado na máquina, aponte para a API publicada na porta do host:

```bash
k6 run -e API_KEY=sk_... -e BASE_URL=http://localhost:3000 loadtest/k6/post-notifications.js
```

## O que olhar

| Onde | Métrica | Por que |
| --- | --- | --- |
| k6 | `http_req_duration{name:create}` p95/p99 | latência de aceitar o pedido |
| k6 | `e2e_accept_to_final_ms` | tempo do 202 até `SENT`/`FAILED`; cresce quando a fila acumula |
| k6 | `notifications_accepted` / `dropped_iterations` | `dropped_iterations` > 0 significa que o gerador de carga ou a API não acompanhou a taxa pedida |
| RabbitMQ (`:15672`) | mensagens prontas por fila | se só sobe, o worker é o gargalo |
| Grafana (`:3030`) | dashboard do gateway | vazão da API vs. do worker lado a lado |
| `docker stats` | CPU de `api`, `worker`, `postgres` | quem satura primeiro |

## Rodadas

| Rodada | Mudança | Resultado |
| --- | --- | --- |
| 1 (baseline) | nenhuma | API aceitou 1000 req/s sem falhas (create p95 142 ms). Fila de e-mail acumulou ~39 mil mensagens; `e2e_timeouts` = 122. SMS e push (simulados) sem fila. Vazão de e-mail ≈ 20/s |
| 2 | pool SMTP no worker (`pool: true`) | sem efeito na vazão: e-mail seguiu em ~20/s (fila de ~19 mil ao fim). Cada envio leva ~43 ms por conexão mesmo reaproveitada, e o consumidor processava uma mensagem por vez |
| 3 | tentativa de `CONSUMER_PREFETCH=20` (variável não chegou ao worker: rodou **sem limite de prefetch** e pool SMTP de 5) | e-mail a ~111/s (5,5× a rodada 1), `e2e_timeouts` 0, create p95 22 ms. Fila de e-mail drenou ~3 min depois da rampa. `duration_ms` de e-mail ficou inflado (média 55 s: inclui espera na fila do pool) |
| 4 | `CONSUMER_PREFETCH=20` de verdade (pool SMTP = 20) | a medir. Meta: e-mail acompanhar os ~333/s do degrau de 1000 req/s |

Causa da rodada 1: o worker processava uma mensagem por vez (`prefetch(1)`) e cada
e-mail leva ~43 ms (`delivery_attempts.duration_ms`), o que dá ~20 e-mails/s. O
pool da rodada 2 não mudou isso (o custo não era a conexão). A rodada 3 paraleliza
com `CONSUMER_PREFETCH`.

`e2e_timeouts` não serve para comparar rodadas: cada timeout prende um VU por 120 s
e o cenário `e2e` tem teto de VUs, então a contagem depende de quantas iterações
couberam. Compare a vazão de e-mail por minuto e a fila ao fim da rampa.

### Rodada 4: o que muda nos passos abaixo

Antes do passo 2, defina no `.env` (o worker lê no boot):

```bash
echo 'CONSUMER_PREFETCH=20' >> .env
```

Depois do `up`, **confirme que chegou ao worker** antes da rampa (na rodada 3
ele não chegou e ninguém percebeu pelos números):

```bash
docker compose exec -T worker sh -c 'echo "CONSUMER_PREFETCH=[$CONSUMER_PREFETCH]"'
curl -s -u notifications:notifications http://localhost:15672/api/consumers \
  | python3 -c "import json,sys; [print(c['queue']['name'], 'prefetch_count =', c['prefetch_count']) for c in json.load(sys.stdin)]"
```

Esperado: `CONSUMER_PREFETCH=[20]` e `prefetch_count = 20` nas três filas
(`0` significa sem limite).
O pool SMTP segue o prefetch por padrão (20 conexões). O restante é igual à
rodada 2, trocando o arquivo para `rodada-4.json`. A vazão de e-mail por minuto sai
desta consulta:

```bash
docker compose exec -T postgres psql -U notifications -d notifications -c \
  "select date_trunc('minute', sent_at) m, count(*) from notifications where channel='EMAIL' and sent_at is not null group by 1 order by 1;"
```

Esperado: ~20.000/min ou mais (rodada 3: ~6.700/min; rodadas 1 e 2: ~1.200/min), e a fila de e-mail sem
acúmulo ao fim da rampa. Se ainda acumular, o próximo suspeito é o pool de
conexões do Postgres (o padrão do TypeORM/pg é 10 e cada mensagem faz leitura,
claim e uma transação).

### Preparar e rodar a rodada 2

1. Estado limpo (apaga banco, filas e Mailpit; sem isso o backlog da rodada 1
   contamina a medição):

   ```bash
   docker compose down -v
   ```

2. Subir com a imagem nova do worker:

   ```bash
   docker compose up -d --build --wait api worker
   ```

3. Smoke rápido, para confirmar que o worker subiu com o pool:

   ```bash
   LOADTEST_SMOKE=1 docker compose --profile loadtest run --rm k6
   ```

4. A rampa, guardando o resumo:

   ```bash
   mkdir -p loadtest/results
   docker compose --profile loadtest run --rm k6 run --quiet --log-output=none \
     --summary-export=/results/rodada-2.json /scripts/post-notifications.js
   ```

5. Logo depois, antes de o worker esvaziar a fila, colete a evidência:

   ```bash
   docker compose exec -T postgres psql -U notifications -d notifications -c \
     "select channel, status, count(*) from notifications group by 1,2 order by 1,2;"
   curl -s -u notifications:notifications http://localhost:15672/api/queues/%2F/notifications.email \
     | python3 -c "import json,sys; q=json.load(sys.stdin); print('ready', q['messages_ready'], 'deliver/s', q.get('message_stats',{}).get('deliver_get_details',{}).get('rate'))"
   ```

O que comparar com a rodada 1: `e2e_timeouts` (era 122), mensagens prontas na fila
de e-mail ao fim da rampa (eram ~39 mil) e a taxa de entrega de e-mail (era
~20/s). Se o pool não bastar, a vazão deve subir mas ainda ficar abaixo de 1000/s,
e o próximo passo é paralelizar o consumo.

## Método

1. Escreva a hipótese antes ("com `prefetch(1)` e 1 worker, a fila cresce a partir
   de ~X req/s").
2. Rode a rampa e anote em que degrau os `thresholds` falham.
3. Mude **uma** coisa (réplicas do worker, prefetch, pool do Postgres, índice).
4. Rode de novo e compare. Zere o estado entre rodadas
   (`docker compose down -v`) para não herdar fila e tabela cheias.

Rodar o k6 na mesma máquina da stack divide CPU com ela; trate os números como
comparativos entre rodadas, não como capacidade absoluta.
