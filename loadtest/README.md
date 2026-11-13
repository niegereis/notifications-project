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

Para rodadas completas, `loadtest/run-round.sh <nome>` faz tudo (pré-checagens,
captura de CPU, k6 e consultas ao banco) e guarda a evidência em
`loadtest/results/`. Abaixo, os comandos soltos.

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
| 4 | `CONSUMER_PREFETCH=20` de verdade (pool SMTP = 20) | e-mail acompanhou a demanda (19.832/min no pico, ~330/s). Entrega p95 210 ms (piso da medição), `e2e_timeouts` 0, `dropped_iterations` 0, create p95 7 ms. Todas as 124 mil `SENT`, filas vazias |
| 5 | só a rampa: até 4000 req/s (sem mudança de código) | **teto da API: ~900-990 req/s** (pico 988/s) e depois queda (803 e 520/s) com a carga acima disso. `create` p95 4,6 s, 457 mil iterações descartadas (k6 no teto de 3000 VUs por causa da latência). Worker acompanhou: 262 mil `SENT`, filas vazias. CPU por container não foi capturada |
| 6 | 4 réplicas da API atrás de um nginx (mesma rampa até 4000 req/s) | **escalou pouco**: pico de 1.341 req/s (+36% sobre a rodada 5) e 313.748 aceitas (+19%), contra a previsão de 2.500-3.500. A soma do CPU dos containers ficou em mediana de 816% e máximo de 946% de 1000% (10 núcleos): o limite passou a ser a máquina. Worker acumulou 131 mil mensagens. 7 erros 502 por corrida de keepalive no nginx (corrigida) |
| 7 antes | `pg_stat_statements` ligado; 500, 1000 e 1500 req/s, uma API | 15,0 consultas por notificação (7 na API, 8 no worker) e só 0,38 ms de execução no banco por notificação: o custo está no número de idas e voltas, não em consulta lenta. 152.097 aceitas, pico de 789/s |
| 7 depois | API faz 2 consultas em vez de 7 (cache de template, `insert`, sem releitura) | 10 consultas por notificação (-33%); CPU da API por 1000 notificações 1,4 para 0,9 s (-36%); 189.872 aceitas (+25%), pico de 1.160/s; `create` mediano de 915 ms para 10 ms. Gargalo passa para o worker: fila de e-mail com 11 mil mensagens ao fim e `e2e` p95 de 6 s para 31 s |

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

### Rodada 5: achar o teto

A rodada 4 mostrou que 1000 req/s passa com folga (`vus_max` no piso de 120,
create p95 de 7 ms), então ela não diz onde o sistema satura. Esta rodada só
sobe a rampa; o código é o mesmo da rodada 4 (confirme `CONSUMER_PREFETCH=20` no
worker, como na rodada 4).

```bash
echo 'LOADTEST_TARGETS=1000,2000,3000,4000' >> .env
docker compose down -v && docker compose up -d --build --wait api worker
```

Confira o prefetch (mesma verificação da rodada 4) e rode, trocando o nome do
resumo:

```bash
docker compose --profile loadtest run --rm k6 run --quiet --log-output=none \
  --summary-export=/results/rodada-5.json /scripts/post-notifications.js
```

Em outro terminal, durante a rampa, capture quem está com a CPU no teto (a cada
10 s, salvando em arquivo):

```bash
while true; do docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' >> loadtest/results/stats-rodada-5.txt; echo --- >> loadtest/results/stats-rodada-5.txt; sleep 10; done
```

(Ctrl+C ao fim.) O k6 e o stack dividem a CPU da máquina, então antes de culpar
a API descubra de quem é o limite:

| Sintoma | Leitura |
| --- | --- |
| `dropped_iterations` alto, mas `create` p95 ainda baixo | o k6 não consegue gerar a taxa: limite do gerador de carga |
| `create` p95/p99 sobe ou aparecem falhas, k6 com CPU sobrando | a API (ou Redis/Postgres/RabbitMQ) saturou |
| `create` bom, mas fila de e-mail cresce ou `e2e_accept_to_final_ms` sobe | o worker voltou a ser o gargalo (a 4000 req/s o e-mail pede ~1.300/s, bem acima dos ~450/s medidos com 20 conexões) |
| `api` ou `postgres` com CPU em ~100% | candidatos: INSERT da API, pool do Postgres (padrão `pg`: 10 conexões) |

Hipótese a registrar antes de rodar: o e-mail volta a ser o primeiro gargalo,
entre 1000 e 2000 req/s, porque 20 conexões entregam ~450/s e cada pedido de
e-mail soma 1/3 da taxa total. Se a API aceitar sem falhas e a fila de e-mail
crescer, a próxima mudança de uma variável só é subir `CONSUMER_PREFETCH` (e o
pool junto) para 50 e repetir.

### Rodada 6: escalar a API

A rodada 5 mostrou que uma instância da API satura em ~1000 req/s, com 9 dos 10
núcleos da máquina ociosos. A API é um único processo Node (um núcleo). A hipótese
é que o limite é a CPU desse processo e que a vazão sobe quase linearmente com as
réplicas, até outro componente virar o teto.

Uma variável só: o número de réplicas (4). A rampa é a mesma da rodada 5
(`LOADTEST_TARGETS=1000,2000,3000,4000`), para comparar direto.

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.scale.yml
docker compose down -v
API_REPLICAS=4 docker compose up -d --build --wait api worker lb
```

O `COMPOSE_FILE` vale só no terminal onde foi exportado; ele inclui o
[docker-compose.scale.yml](../docker-compose.scale.yml), que tira a porta do host
da `api`, sobe as réplicas e põe o `lb` ([nginx](../docker/nginx-lb/nginx.conf))
na porta 3000 e na frente do k6. Se escalar a API depois, reinicie o `lb`
(`docker compose restart lb`): o nginx resolve os IPs das réplicas na subida.

Confirme que há 4 réplicas e que o balanceador distribui:

```bash
docker compose ps api --format '{{.Name}} {{.Status}}'
for i in 1 2 3 4 5 6 7 8; do curl -s -o /dev/null -w '%{http_code} ' http://localhost:3000/health; done; echo
```

Depois rode tudo com um comando. O script verifica o prefetch, captura o CPU de
todos os containers durante a rampa e salva a evidência (resumo do k6, CPU, fila e
entregas por minuto no banco) em `loadtest/results/`:

```bash
loadtest/run-round.sh rodada-6
```

O que prever antes de rodar, para não racionalizar depois:

- **API:** com 4 réplicas, a taxa aceita deve passar bem de 1000 req/s (esperado
  algo entre 2500 e 3500). Se ficar presa em ~1000 mesmo com as 4 réplicas com CPU
  sobrando, o gargalo não é o núcleo do Node: suspeite do Postgres ou do Redis.
- **Worker:** a 3000 req/s o e-mail pede ~1000/s, acima dos ~450/s que 20 conexões
  entregam. É esperado que a fila de e-mail **cresça** nos degraus altos e o
  `e2e_timeouts` volte a falhar. Isso é o worker virando o gargalo, não um erro do
  teste, e dita a rodada 7 (`CONSUMER_PREFETCH` e pool maiores, ou mais workers).
- **k6:** com 4 réplicas e latência baixa, o k6 usa menos VUs; mas a 3000-4000
  req/s ele disputa CPU com o stack. `dropped_iterations` alto **com** latência de
  `create` baixa significa que o limite é o gerador, não o sistema.

Como ler o `stats-rodada-6.txt` (CPU de pico, 100% = um núcleo):

| Achado | Leitura |
| --- | --- |
| cada `api-N` perto de 100% | a API continua limitada por CPU; mais réplicas ainda ajudam |
| `api-N` abaixo de ~60% e `create` lento | o gargalo está depois da API (Postgres, Redis, RabbitMQ) |
| `postgres` perto de 100%+ | o INSERT por pedido virou o limite; avalie pool, índices e `max_connections` |
| `k6` (container) perto do teto da máquina | limite do gerador de carga |

Limitação: o Prometheus raspa `api:3000`, que resolve para uma réplica por vez,
então os gráficos da API no Grafana mostram só uma fatia. Use o k6 e o
`stats-*.txt`.

Para voltar ao modo de uma instância: `unset COMPOSE_FILE` e
`docker compose down -v && docker compose up -d --build --wait api worker`.

### Rodada 7: reduzir trabalho por pedido

Com a máquina saturada (rodada 6), escalar mais não ajuda: sobra reduzir o que
cada pedido custa. Em vez de adivinhar, a rodada usa o `pg_stat_statements`
(override [docker-compose.profiling.yml](../docker-compose.profiling.yml)); o
`run-round.sh` o ativa, zera antes da rampa e imprime consultas por notificação,
tempo de banco por notificação e as consultas mais caras.

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.profiling.yml
docker compose down -v && docker compose up -d --build --wait api worker
LOADTEST_TARGETS=500,1000,1500 loadtest/run-round.sh rodada-7-antes
# aplicar a otimização, recriar com banco limpo e repetir com o nome rodada-7-depois
```

O que o baseline mostrou: **15 consultas por notificação** e 0,38 ms de execução
por notificação. O Postgres chegou a 206% de CPU sem nenhuma consulta lenta; o
custo está nas 2,3 milhões de idas e voltas (protocolo, rede e a montagem de
entidades do TypeORM). Na API eram 7: template (1), `START TRANSACTION` e `COMMIT`
do `save` (2), `INSERT` (1), checagem de chave estrangeira (1) e a releitura final
com `JOIN` (2).

A mudança (commit `perf(api)`): cache de template por 60 s, `insert` no lugar de
`save`, e sem a releitura (pedido novo não tem tentativas nem desfecho). A resposta
do `POST` ficou idêntica (testes unitários, e2e e um `POST` real).

| Mesma rampa, uma API | Antes | Depois |
| --- | --- | --- |
| Consultas por notificação | 15,0 | 10,0 (*) |
| CPU da API por 1000 notificações | 1,4 s | 0,9 s (-36%) |
| CPU do Postgres por 1000 notificações | 1,8 s | 1,2 s (-33%) (**) |
| Tempo de execução no banco por notificação | 0,384 ms | 0,370 ms |
| Pedidos aceitos na rampa | 152.097 | 189.872 (+25%) |
| Pico de pedidos aceitos por segundo | 789 | 1.160 |
| `create` mediano / p95 | 915 ms / 4,64 s | 10 ms / 3,19 s |
| Fila de e-mail ao fim da rampa | 23 | 11.270 |
| `e2e` p95 | 6,3 s | 30,6 s |

(\*) O `pg_stat_statements` mediu 9,67: quando as estatísticas foram coletadas, o
worker ainda não tinha processado 11 mil mensagens. Com todas processadas são 2 na
API + 8 no worker = 10.

(\*\*) Subestimado: parte do trabalho do worker e do Postgres acontece depois do fim
da rampa e não entra nas amostras de CPU.

Como ler isso:

- O **tempo de execução no banco não mudou** (0,384 para 0,370 ms), mas o **CPU do
  Postgres caiu na mesma proporção das consultas** (-33%). O custo do banco aqui
  acompanha o número de consultas, não o tempo que cada uma leva.
- O **`e2e` piorou e o limite `e2e_accept_to_final_ms` passou de ✓ para ✗**, mas não
  foi regressão: a API passou a aceitar mais, e o worker (um processo) não acompanhou.
  O gargalo se moveu para ele, como nas rodadas anteriores. O `create` p95 ainda
  falha nas duas rodadas porque o degrau de 1500 req/s excede de propósito a
  capacidade de uma instância.
- Foi **uma rodada de cada**. O número determinístico (consultas por notificação) é
  exato; os de CPU e vazão trazem a variação normal entre rodadas, que não medi.

## Método

1. Escreva a hipótese antes ("com `prefetch(1)` e 1 worker, a fila cresce a partir
   de ~X req/s").
2. Rode a rampa e anote em que degrau os `thresholds` falham.
3. Mude **uma** coisa (réplicas do worker, prefetch, pool do Postgres, índice).
4. Rode de novo e compare. Zere o estado entre rodadas
   (`docker compose down -v`) para não herdar fila e tabela cheias.

Rodar o k6 na mesma máquina da stack divide CPU com ela; trate os números como
comparativos entre rodadas, não como capacidade absoluta.
