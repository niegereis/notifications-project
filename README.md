# Notification Gateway

Serviço HTTP que outros sistemas chamam para enviar notificações por e-mail, SMS
ou push. Recebe o pedido, valida, renderiza o template, persiste o registro,
publica na fila do canal e devolve `202 Accepted`. Um processo separado (worker)
consome a fila, chama o provedor, registra cada tentativa e, se o cliente pediu,
avisa o desfecho por webhook.

Não é um produto para pessoas finais: não há login de usuário, sessão ou tela de
cadastro. Quem autentica é o serviço chamador, com uma API key no header.

Este arquivo descreve o comportamento implementado no repositório: como subir,
como chamar a API, como as filas e o banco funcionam, e como operar o conjunto
em desenvolvimento.

## Sumário

1. [O que o serviço faz](#o-que-o-serviço-faz)
2. [Stack](#stack)
3. [Estrutura do repositório](#estrutura-do-repositório)
4. [Processos: API e worker](#processos-api-e-worker)
5. [Arquitetura](#arquitetura)
6. [Como rodar](#como-rodar)
7. [Autenticação](#autenticação)
8. [API HTTP](#api-http)
9. [Templates](#templates)
10. [Idempotência](#idempotência)
11. [Rate limit](#rate-limit)
12. [Modelo de dados](#modelo-de-dados)
13. [Mensageria (RabbitMQ)](#mensageria-rabbitmq)
14. [Entrega, retry e dead-letter](#entrega-retry-e-dead-letter)
15. [Provedores (e-mail, SMS, push)](#provedores-e-mail-sms-push)
16. [Webhooks de desfecho](#webhooks-de-desfecho)
17. [Redrive](#redrive)
18. [Observabilidade](#observabilidade)
19. [Mini-painel](#mini-painel)
20. [Variáveis de ambiente](#variáveis-de-ambiente)
21. [Banco e migrations](#banco-e-migrations)
22. [Testes e CI](#testes-e-ci)
23. [Comandos](#comandos)
24. [Operação e problemas comuns](#operação-e-problemas-comuns)

## O que o serviço faz

- Aceita `POST /notifications` com canal, tipo de evento, destinatário e payload.
- Resolve o template `(eventType, channel)`, substitui `{{variável}}` e grava o
  texto final no registro. Editar o template depois não muda o histórico.
- Publica só o `notificationId` (e o canal) no RabbitMQ. O conteúdo fica no
  Postgres; o worker relê o registro na hora de enviar.
- Entrega com no máximo 3 tentativas por ciclo. Entre as falhas 1 e 2 espera 1s;
  entre as falhas 2 e 3 espera 5s. Na terceira falha o status vira `FAILED` e a
  mensagem vai para a fila `notifications.dead`.
- Isola um serviço chamador do outro: listagem e detalhe filtram por
  `requestedBy`. Id de outro dono responde `404`, não `403`.
- Garante replay seguro com `Idempotency-Key` no Redis (`SET NX`).
- Limita pedidos por destinatário+canal (não por serviço chamador).
- Expõe métricas Prometheus na API (`:3000/metrics`) e no worker (`:9464/metrics`).

O que o serviço não faz:

- Não envia sem template cadastrado para aquele `eventType` + `channel`.
- Não decide o status da notificação pelo resultado do webhook. O GET é a fonte
  da verdade; o callback é um aviso.
- Não sincroniza o schema TypeORM em runtime (`synchronize: false`). Toda
  mudança de tabela passa por migration.

## Stack

| Camada | Escolha |
| --- | --- |
| Runtime | Node.js 22, TypeScript, ESM (`"type": "module"`, `module: nodenext`) |
| API e worker | NestJS 12 (mesmo código; entrypoints `src/main.ts` e `src/worker.ts`) |
| HTTP | Express via `@nestjs/platform-express` |
| Banco | PostgreSQL 17 + TypeORM (`pg`) |
| Cache | Redis 7 (AOF ligado no Compose) |
| Mensageria | RabbitMQ 4 (plugin de management + plugin Prometheus) |
| E-mail | Nodemailer; Mailpit como SMTP local |
| SMS | Twilio; sem credencial, simula no log do worker |
| Push | FCM HTTP v1; sem credencial, simula no log do worker |
| Testes | Vitest (unitários com SWC) + Supertest (e2e) |
| Mini-painel | React 19 + Vite 8 |
| Observabilidade | prom-client, Prometheus, Grafana |
| Infra local | Docker Compose |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

Imports relativos no backend terminam em `.js` mesmo nos arquivos `.ts`: é o
contrato do TypeScript com `nodenext` em ESM. Os testes usam SWC para preservar
decorators e `emitDecoratorMetadata`, de que a injeção do Nest depende.

## Estrutura do repositório

```
.
├── .env.example                 # copie para .env antes do compose
├── docker-compose.yml           # Postgres, Redis, RabbitMQ, Mailpit, migrate, api, worker, web, Prometheus, Grafana
├── docker/
│   ├── postgres/init-test-db.sh # cria o banco notifications_test no primeiro boot
│   ├── rabbitmq/enabled_plugins
│   ├── prometheus/prometheus.yml
│   └── grafana/                 # datasource + dashboard provisionados
├── backend/                     # API + worker (NestJS)
│   ├── src/
│   │   ├── main.ts              # processo HTTP
│   │   ├── worker.ts            # processo consumidor (ApplicationContext)
│   │   ├── app.module.ts
│   │   ├── auth/                # API key, guard global, whoami
│   │   ├── config/              # validação de env no boot
│   │   ├── database/            # TypeORM, data-source, migrations, seed
│   │   ├── delivery/            # DeliveryService + provedores por canal
│   │   ├── health/              # /health e /health/ready
│   │   ├── messaging/           # AMQP, topologia, publisher, retry
│   │   ├── metrics/             # Prometheus (API e HTTP mínimo do worker)
│   │   ├── notifications/       # HTTP, persistência, processor, idempotência, rate limit
│   │   ├── redis/
│   │   ├── templates/
│   │   ├── webhooks/
│   │   └── worker/              # consumer das filas de trabalho
│   ├── test/                    # e2e (Supertest contra AppModule)
│   └── Dockerfile               # targets: deps, build, production, development
└── web/                         # mini-painel (formulário + tabela)
    ├── src/
    └── nginx.conf               # proxy /notifications, /auth e /health para a API
```

Cada módulo Nest junta os arquivos por tipo (`controllers/`, `services/`,
`entities/`, etc.). O `*.module.ts` fica na raiz do módulo.

## Processos: API e worker

São dois processos do mesmo pacote `backend`.

| Processo | Entry | O que faz | O que não faz |
| --- | --- | --- | --- |
| API | `src/main.ts` -> `AppModule` | HTTP, validação, idempotência, rate limit, render de template, INSERT, publish, listagem, redrive | Não chama Twilio/FCM/SMTP |
| Worker | `src/worker.ts` -> `WorkerModule` | Consome as filas, chama o provedor, grava tentativas, webhook, métricas de entrega | Não usa Redis; não expõe a API Nest |

A API escuta `PORT` (default 3000) em `0.0.0.0`, com CORS liberado para
`Content-Type`, `x-api-key` e `Idempotency-Key`. O `ValidationPipe` global usa
`whitelist` e `forbidNonWhitelisted`: campo extra no JSON vira `400`.

O worker sobe `NestFactory.createApplicationContext` (sem servidor HTTP Nest) e
expõe só `/metrics` num HTTP mínimo em `METRICS_PORT` (9464).

Os dois habilitam shutdown hooks. A topologia AMQP é declarada na conexão
(exchanges, filas, bindings, prefetch 1).

## Arquitetura

```
Serviço cliente
      |
      |  POST /notifications  (x-api-key, Idempotency-Key opcional)
      v
   API NestJS
      |  1. valida DTO + destinatario do canal
      |  2. reserva Idempotency-Key no Redis (SET NX), se veio header
      |  3. rate limit por canal+destinatario (INCR)
      |  4. renderiza template e grava Notification PENDING
      |  5. publica { notificationId, channel } na exchange `notifications`
      |
      |  202 + corpo do recurso
      v
exchange topic `notifications`
      |  routing key notification.email | notification.sms | notification.push
      +------------------+------------------+
      v                  v                  v
fila email          fila sms           fila push
      |                  |                  |
      +------------------+------------------+
                         v
                      Worker
                         |  prefetch(1), ack manual
                         |  lê o registro no Postgres
                         |  DeliveryService escolhe o provedor pelo canal
                         |
          sucesso ------> ack, status SENT, webhook opcional
          falha 1/2 ----> grava tentativa, publica wait-queue TTL, ack
          falha 3 ------> status FAILED, publica notifications.dead, webhook
```

A wait-queue de retry usa TTL + dead-letter de volta para a fila de trabalho do
mesmo canal. Não é nack+requeue na hora: isso inundaria o worker.

## Como rodar

Pré-requisitos: Docker e Docker Compose. Node 22 só é necessário se for rodar
API, worker ou painel fora do Compose.

### Tudo no Compose

```bash
cp .env.example .env
docker compose up -d --build
```

O serviço `migrate` aplica as migrations e o seed de templates, sai, e só
então a API e o worker sobem (`depends_on: service_completed_successfully`).
Várias réplicas da API não correm migration em paralelo.

| Serviço | Endereço |
| --- | --- |
| API | http://localhost:3000 |
| Mini-painel | http://localhost:8080 |
| Health (liveness) | http://localhost:3000/health |
| Health (readiness) | http://localhost:3000/health/ready |
| Métricas da API | http://localhost:3000/metrics |
| Métricas do worker | http://localhost:9464/metrics |
| Identidade da API key | http://localhost:3000/auth/whoami |
| Caixa de entrada (Mailpit) | http://localhost:8025 |
| Painel do RabbitMQ | http://localhost:15672 (usuário e senha `notifications`) |
| Prometheus do RabbitMQ | http://localhost:15692/metrics |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3030 (anônimo, papel Viewer, sem formulário de login) |
| Postgres | `localhost:5432` |
| Redis | `localhost:6379` |

Chaves de desenvolvimento (também no `.env.example`; não reútilize fora disto):

| Serviço | Chave |
| --- | --- |
| `billing` | `sk_a78dff27f6c483432ca937d9eceeeb92ebc0a8dbc8c6cb36` |
| `crm` | `sk_89a68d0cdddd1da187530592708a1183bf04cbc87c2c9f98` |

O painel usa a chave do `billing` por padrao (`PANEL_API_KEY`).

### Hot reload na maquina

Suba só a infraestrutura e rode os processos Node localmente. O `.env.example`
já aponta `DATABASE_URL`, `REDIS_URL`, `RABBITMQ_URL` e SMTP para `localhost`.

```bash
docker compose up -d postgres redis rabbitmq mailpit
cd backend
npm install
npm run db:run
npm run db:seed
npm run start:dev            # terminal 1 — HTTP em :3000
npm run start:worker:dev     # terminal 2 — consome a fila; métricas em :9464
cd ../web
npm install
npm run dev                  # terminal 3 — http://localhost:5173
```

O Vite faz proxy de `/notifications`, `/auth` e `/health` para
`http://localhost:3000`. O nginx do Compose faz o mesmo na porta 8080.

Para parar o stack:

```bash
docker compose down
```

Volumes (`postgres-data`, `redis-data`, `rabbitmq-data`) sobrevivem ao `down`.
Para zerar estado local: `docker compose down -v`.

## Autenticação

Header obrigatório: `x-api-key`.

Rotas publicas (decorator `@Public()`): `GET /health`, `GET /health/ready` e
`GET /metrics`. O orquestrador e o Prometheus não carregam chave.

O `ApiKeyGuard` é global (`APP_GUARD`). Esquecer `@Public()` fecha a rota; o
inverso abriria uma rota por engano.

`API_KEYS` no ambiente: `serviço:chave,serviço:chave`. Regras no parse:

- ao menos uma entrada
- chave com no mínimo 16 caracteres
- nome de serviço único
- chave unica (comparação pelo hash SHA-256, não pela string em claro)

A resolucao usa um `Map` de hash -> `{ name }`. O nome vira `requestedBy` em
toda notificação criada por aquela chave.

```bash
curl -H "x-api-key: SUA_CHAVE" http://localhost:3000/auth/whoami
# {"client":"billing"}
```

Gerar chave nova:

```bash
openssl rand -hex 32
```

## API HTTP

Base: `http://localhost:3000`. JSON UTF-8. Datas em ISO-8601 (timestamptz).

### GET /auth/whoami

Retorna o nome do serviço autenticado.

```json
{ "client": "billing" }
```

### POST /notifications

Aceita o pedido. Resposta `202 Accepted`. A entrega e assincrona.

Headers:

| Header | Obrigatorio | Notas |
| --- | --- | --- |
| `x-api-key` | sim | identifica o serviço |
| `Content-Type` | sim | `application/json` |
| `Idempotency-Key` | não | 1 a 255 caracteres depois do trim |

Corpo:

| Campo | Tipo | Regras |
| --- | --- | --- |
| `channel` | string | `EMAIL`, `SMS` ou `PUSH` |
| `eventType` | string | max 100; formato `dominio.evento` (ex.: `order.shipped`) |
| `recipient` | string | max 255; formato depende do canal (tabela abaixo) |
| `payload` | objeto | opcional; default `{}`; alimenta `{{variável}}` do template |
| `callbackUrl` | string | opcional; http/https, max 2048; webhook de SENT/FAILED |

Destinatario por canal:

| Canal | Formato |
| --- | --- |
| `EMAIL` | e-mail (`local@dominio.tld`) |
| `SMS` | E.164 (`+` + DDI + número, 8 a 15 digitos no total depois do +) |
| `PUSH` | device token com no mínimo 16 caracteres |

Exemplo:

```bash
curl -X POST http://localhost:3000/notifications \
  -H "x-api-key: SUA_CHAVE" \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "EMAIL",
    "eventType": "order.shipped",
    "recipient": "ana@exemplo.com",
    "payload": {
      "nome": "Ana",
      "numeroPedido": "PED-1234",
      "prazo": "sexta-feira",
      "rastreio": "BR123456789"
    }
  }'
```

Corpo de resposta (recurso). `attempts` vem no GET por id (e também neste POST,
porque o create relê o registro):

```json
{
  "id": "uuid",
  "channel": "EMAIL",
  "eventType": "order.shipped",
  "recipient": "ana@exemplo.com",
  "status": "PENDING",
  "requestedBy": "billing",
  "subject": "Seu pedido PED-1234 saiu para entrega",
  "body": "Olá Ana,\n\nO pedido PED-1234 ...",
  "callbackUrl": null,
  "failureReason": null,
  "sentAt": null,
  "createdAt": "2026-09-24T18:00:00.000Z",
  "attempts": []
}
```

Codigos:

| Situação | HTTP |
| --- | --- |
| Pedido aceito, ainda não entregue | `202` com `status: PENDING` |
| Replay da mesma `Idempotency-Key` e mesmo fingerprint | `202` com o recurso já criado |
| JSON inválido, campo extra, destinatário incompatível com o canal, `Idempotency-Key` vazia ou > 255 | `400` |
| Sem API key ou chave inválida | `401` |
| Mesma `Idempotency-Key` com corpo diferente, ou reserva ainda sem id gravado | `409` |
| Id de outro serviço (nos GETs) | `404` |
| Sem template para o evento+canal, payload sem variável obrigatória, canal sem provedor | `422` |
| Teto de envios do destinatário | `429` + `Retry-After` |
| RabbitMQ recusou o publish | `503` (o registro fica `FAILED` com motivo de enqueue) |

`order.shipped` também tem template de SMS e push:

```bash
# SMS
curl -X POST http://localhost:3000/notifications \
  -H "x-api-key: SUA_CHAVE" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"SMS","eventType":"order.shipped","recipient":"+5511999999999","payload":{"numeroPedido":"PED-1234","rastreio":"BR123456789"}}'

# PUSH (token de exemplo do painel)
curl -X POST http://localhost:3000/notifications \
  -H "x-api-key: SUA_CHAVE" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"PUSH","eventType":"order.shipped","recipient":"device-token-demo-01","payload":{"numeroPedido":"PED-1234"}}'
```

Replay com chave:

```bash
curl -X POST http://localhost:3000/notifications \
  -H "x-api-key: SUA_CHAVE" \
  -H "Idempotency-Key: pedido-42" \
  -H 'Content-Type: application/json' \
  -d '{"channel":"EMAIL","eventType":"order.shipped","recipient":"ana@exemplo.com","payload":{"nome":"Ana","numeroPedido":"PED-1234","prazo":"sexta-feira","rastreio":"BR123456789"}}'
```

### GET /notifications

Lista só as notificações do serviço autenticado, da mais nova para a mais
antiga. Não inclui `attempts` (o histórico fica no GET por id).

Query:

| Parametro | Default | Notas |
| --- | --- | --- |
| `status` | (todos) | `PENDING`, `PROCESSING`, `SENT`, `FAILED` |
| `channel` | (todos) | `EMAIL`, `SMS`, `PUSH` |
| `recipient` | (todos) | match exato, max 255 |
| `page` | `1` | inteiro >= 1 |
| `pageSize` | `20` | 1 a 100 |

```bash
curl -H "x-api-key: SUA_CHAVE" \
  'http://localhost:3000/notifications?channel=EMAIL&status=FAILED&page=1&pageSize=20'
```

```json
{
  "items": [ { "...recurso sem attempts..." } ],
  "page": 1,
  "pageSize": 20,
  "total": 42
}
```

### GET /notifications/:id

UUID. Inclui `attempts` ordenadas por `attemptNumber`. Outro dono: `404`.

```bash
curl -H "x-api-key: SUA_CHAVE" http://localhost:3000/notifications/ID
```

Cada item de `attempts`:

| Campo | Significado |
| --- | --- |
| `attemptNumber` | 1, 2 ou 3 dentro do ciclo atual |
| `status` | `SUCCESS` ou `FAILURE` |
| `error` | mensagem do provedor, ou `null` |
| `providerMessageId` | id devolvido pelo SMTP/Twilio/FCM (ou o id simulado) |
| `durationMs` | duração da chamada ao provedor |
| `createdAt` | quando a tentativa foi gravada |

### POST /notifications/:id/redrive

Reprocessa uma notificação `FAILED` do próprio serviço. Resposta `202`.
Qualquer outro status: `409`. Ver [Redrive](#redrive).

```bash
curl -X POST http://localhost:3000/notifications/ID/redrive \
  -H "x-api-key: SUA_CHAVE"
```

### POST /notifications/dead/redrive

Drena até `limit` mensagens da fila `notifications.dead` (default 50, max 100).

```bash
curl -X POST http://localhost:3000/notifications/dead/redrive \
  -H "x-api-key: SUA_CHAVE" \
  -H 'Content-Type: application/json' \
  -d '{"limit":50}'
```

```json
{ "redriven": ["uuid-1"], "discarded": 0, "returned": 2 }
```

- `redriven`: ids FAILED do serviço autenticado que voltaram para a fila de trabalho
- `discarded`: mensagem sem registro, ou já `SENT` (órfã)
- `returned`: mensagem de outro dono, ou status diferente de `FAILED`; volta para a DLQ

### GET /health

Liveness: o processo HTTP esta de pé. Não consulta Postgres/Redis/RabbitMQ.
Usar para o orquestrador decidir restart.

### GET /health/ready

Readiness: heap abaixo de 512 MiB, ping no Postgres, canal AMQP conectado, ping
no Redis. Sem Redis a API não garante idempotência nem rate limit e recusa
carga. Misturar live e ready faz o orquestrador matar um processo saudavel só
porque o banco esta lento.

### GET /metrics

Texto Prometheus (`text/plain; version=0.0.4`). Público. Na API, só os
contadores de aceite/replay/enqueue/redrive. No worker (`:9464/metrics`),
contadores de envio, retry, falha, webhook e histogramas de latência.

## Templates

Tabela `templates`, único por `(eventType, channel)`. Placeholders:
`{{nomeDaVariavel}}` (espaços internos opcionais). Variável ausente, `null` ou
string vazia no payload: o POST inteiro falha com `422`. Não interpola string
vazia no e-mail.

O seed (`npm run db:seed` / serviço `migrate` do Compose) faz upsert de:

| eventType | canal | Variáveis |
| --- | --- | --- |
| `user.welcome` | EMAIL | `nome`, `produto` |
| `order.shipped` | EMAIL | `nome`, `numeroPedido`, `prazo`, `rastreio` |
| `password.reset` | EMAIL | `nome`, `codigo`, `minutos` |
| `order.shipped` | SMS | `numeroPedido`, `rastreio` |
| `order.shipped` | PUSH | `numeroPedido` |

Subject de SMS e push é `null`. O corpo renderizado (e o subject de e-mail) são
copiados para a linha da notificação no POST. O worker não consulta template de
novo.

Para cadastrar outro evento, insira na tabela `templates` (mesmo `eventType` em
canais diferentes é permitido; o par evento+canal é que é único).

## Idempotência

Header `Idempotency-Key`, opcional. Sem o header, cada POST é um pedido novo.

Chave Redis: `idempotency:{serviço}:{chave}`. TTL default 86400 s
(`IDEMPOTENCY_TTL_SECONDS`).

Fluxo:

1. `SET NX` com JSON `{ fingerprint }`. Se adquiriu, segue o POST.
2. Se a chave já existia com o mesmo fingerprint e já tem `notificationId`,
   devolve o recurso existente (`202`) e não conta no rate limit.
3. Se o fingerprint for diferente, ou a reserva ainda não tiver id (POST em
   andamento), responde `409`.
4. Se o POST falhar depois da reserva, a chave e solta (`DEL`) para o cliente
   poder repetir.
5. Depois do publish com sucesso, a reserva e commitada com o id.

Fingerprint: SHA-256 de `channel`, `eventType`, `recipient`, `payload` com
chaves ordenadas, e `callbackUrl` (ou `null`). Trocar só a ordem das chaves do
JSON não muda o fingerprint.

## Rate limit

Janela fixa no Redis: `ratelimit:{canal}:{destinatário}`.

- primeiro hit: `INCR` + `EXPIRE` da janela
- hits seguintes: só `INCR`
- passou de `RATE_LIMIT_MAX`: `429` e `Retry-After` com o TTL restante

Defaults: 10 pedidos / 60 s (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`).

O teto é da pessoa no canal, não do serviço chamador. Dez e-mails da billing e
dez da crm para o mesmo endereço somam. Replay de idempotência não incrementa.

## Modelo de dados

TypeORM, `synchronize: false`. Entidades em
`backend/src/notifications/entities` e `backend/src/templates/entities`.

### notifications

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid | PK gerada |
| `channel` | enum `EMAIL/SMS/PUSH` | |
| `event_type` | varchar(100) | |
| `recipient` | varchar(255) | |
| `payload` | jsonb | default `{}` |
| `status` | enum | `PENDING`, `PROCESSING`, `SENT`, `FAILED` |
| `requested_by` | varchar(100) | nome do serviço da API key |
| `subject` | varchar(255) nullable | texto já renderizado |
| `body` | text | texto já renderizado |
| `callback_url` | varchar(2048) nullable | |
| `delivery_cycle` | int | default 0; incrementa no redrive |
| `failure_reason` | text nullable | última falha do provedor (ou enqueue) |
| `sent_at` | timestamptz nullable | |
| `template_id` | uuid nullable | `ON DELETE SET NULL` |
| `created_at` / `updated_at` | timestamptz | |

Indices: `(status, created_at)`, `(channel, status)`, `recipient`, `created_at`,
`(requested_by, created_at)`.

### delivery_attempts

Uma linha por tentativa. Retry não atualiza a linha anterior.

| Coluna | Tipo | Notas |
| --- | --- | --- |
| `id` | uuid | |
| `notification_id` | uuid | `ON DELETE CASCADE` |
| `attempt_number` | int | 1..3 no ciclo |
| `cycle` | int | acompanha `delivery_cycle` da notificação |
| `status` | enum | `SUCCESS` ou `FAILURE` |
| `provider_message_id` | varchar(255) nullable | |
| `error` | text nullable | |
| `duration_ms` | int | |
| `created_at` | timestamptz | |

Único em `(notification_id, cycle, attempt_number)`. Tentativa e status da
notificação são gravados na mesma transação.

### templates

Único em `(event_type, channel)`. `subject` nullable (SMS/push).

## Mensageria (RabbitMQ)

Declarada em `backend/src/messaging/topology/amqp.topology.ts` e aplicada em
`AmqpService` na conexão (com reconnect). Publisher confirms: a API só devolve
`202` depois de o broker confirmar o publish. Consume: `prefetch(1)`, ack
manual depois de processar.

| Recurso | Tipo | Nome |
| --- | --- | --- |
| Exchange de trabalho | topic, durable | `notifications` |
| Exchange de retry | direct, durable | `notifications.retry` |
| Exchange morta | fanout, durable | `notifications.dead` |
| Fila morta | durable | `notifications.dead` (binding vazio no fanout) |

Por canal:

| Canal | Routing key | Fila de trabalho | Filas de espera |
| --- | --- | --- | --- |
| EMAIL | `notification.email` | `notifications.email` | `notifications.email.retry.1000`, `notifications.email.retry.5000` |
| SMS | `notification.sms` | `notifications.sms` | análogas |
| PUSH | `notification.push` | `notifications.push` | análogas |

Cada wait-queue tem `messageTtl` igual ao atraso (1000 ou 5000 ms) e
`deadLetterExchange` = `notifications` com a routing key do canal. Quando o TTL
vence, a mensagem volta para a fila de trabalho.

Payload na fila (único JSON):

```json
{ "notificationId": "uuid", "channel": "EMAIL" }
```

Mensagem inválida é descartada (ack sem processar). Id inexistente no banco:
descartada. Status já `SENT` ou `FAILED`: ignorada (at-least-once: o worker
pode ter morrido depois de gravar e antes do ack).

Falha inesperada (Postgres fora, exceção não tratada) vira nack com requeue.

Publish na DLQ: exchange `notifications.dead`, routing key vazia (fanout).

## Entrega, retry e dead-letter

O `NotificationProcessor` reivindica o registro (`PENDING` ou o status atual ->
`PROCESSING` com update condicional). Depois chama `DeliveryService.send`.

| Resultado | Status final | Fila | Webhook |
| --- | --- | --- | --- |
| Provedor ok | `SENT`, `sent_at` preenchido | ack na de trabalho | se houver `callbackUrl` |
| Falha, tentativa 1 | permanece processando; `failure_reason` | wait 1000 ms, depois volta | não |
| Falha, tentativa 2 | idem | wait 5000 ms | não |
| Falha, tentativa 3 | `FAILED` | `notifications.dead` | se houver `callbackUrl` |

`MAX_DELIVERY_ATTEMPTS = 3`. `retryDelayAfter(1) = 1000`, `retryDelayAfter(2) =
5000`, `retryDelayAfter(3) = null` (dead).

O ciclo (`delivery_cycle`) zera as contas no redrive: as tentativas antigas
ficam no histórico; o processor conta só as linhas do ciclo atual.

Entrega é at-least-once. Se o worker morrer depois do provedor e antes de gravar
`SENT`, um segundo envio ainda e possível.

## Provedores (e-mail, SMS, push)

Contrato `DeliveryProvider`: `{ channel, send(request) }`. O `DeliveryService`
recebe a lista (`DELIVERY_STRATEGIES`) e despacha pela propriedade `channel`.
O worker não tem `if (email) / if (sms)`.

Request: `{ recipient, subject, body }`. Resultado: `{ providerMessageId }`.
Falha de negócio (provedor recusou) lança `DeliveryError` e entra no caminho de
retry. Falha de infraestrutura segue o mesmo caminho de negócio neste código.

| Canal | Implementação | Sem credencial |
| --- | --- | --- |
| EMAIL | Nodemailer (`SMTP_HOST`, `SMTP_PORT`, `MAIL_FROM`; user/password/secure opcionais) | no Compose aponta para Mailpit |
| SMS | Twilio REST | log + id `sms-sim-...` |
| PUSH | FCM HTTP v1 (OAuth com `FCM_CLIENT_EMAIL` + `FCM_PRIVATE_KEY`) | log + id `push-sim-...` |

Twilio exige `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` e `TWILIO_FROM` juntos.
FCM exige `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` e `FCM_PRIVATE_KEY` juntos.
String vazia no env e tratada como ausente.

No Compose local, o e-mail cai no Mailpit (http://localhost:8025). SMS e push
aparecem no log do container `worker`.

## Webhooks de desfecho

Campo `callbackUrl` no POST. Disparado só em `SENT` (depois da 1a sucesso) e
`FAILED` (depois da 3a falha). Retry intermediario não chama o webhook.

POST JSON, timeout 5 s, `User-Agent: notification-gateway/0.1`.

```json
{
  "id": "uuid",
  "channel": "EMAIL",
  "eventType": "order.shipped",
  "recipient": "ana@exemplo.com",
  "status": "SENT",
  "requestedBy": "billing",
  "providerMessageId": "...",
  "failureReason": null,
  "occurredAt": "2026-09-24T18:00:01.000Z"
}
```

Headers:

| Header | Quando |
| --- | --- |
| `Content-Type: application/json` | sempre |
| `X-Webhook-Timestamp` | unix time em segundos |
| `X-Webhook-Signature` | se `WEBHOOK_SECRET` (mínimo 16 caracteres) estiver definido |

Assinatura: `sha256=` + HMAC-SHA256 de `{timestamp}.{body}` com o secret. O
receptor deve recalcular e comparar.

Politica de retry do webhook (independente da entrega):

- HTTP 2xx: ok, para
- HTTP 410: não retenta (endpoint sumiu)
- qualquer outro status ou erro de rede: tenta de novo até 3 vezes, com espera
  de 250 ms na 2a e 1 s na 3a (em teste a espera e 0)

Falha no webhook não muda `status` da notificação. Só loga e incrementa
`notification_webhooks_failed_total`.

## Redrive

Dois caminhos, os dois só para o dono da API key.

**Por id.** A notificação precisa estar `FAILED`. O serviço:

1. incrementa `delivery_cycle`
2. volta `status` para `PENDING`, limpa `failure_reason` e `sent_at`
3. publica de novo na exchange de trabalho

Se o publish falhar, desfaz o ciclo e o status. `409` se não estava `FAILED`
(ou se outro request já reivindicou).

**Pela DLQ.** `GET` não lista a fila morta; o POST puxa mensagens com
`basic.get`. SENT órfãs e ids inexistentes são descartadas (ack sem republicar).
Mensagens de outro serviço voltam para `notifications.dead`.

As tentativas do ciclo anterior permanecem em `delivery_attempts`. O GET por id
mostra o histórico completo.

## Observabilidade

### Métricas da aplicação

Label comum: `channel` (`EMAIL`, `SMS`, `PUSH`). Histogramas usam segundos.

| Metrica | Processo | Significado |
| --- | --- | --- |
| `notifications_accepted_total` | API | POST 202 que criou pedido |
| `notifications_replayed_total` | API | replay de Idempotency-Key |
| `notifications_enqueue_failed_total` | API | publish falhou (HTTP 503) |
| `notifications_redriven_total` | API | FAILED recolocado na fila |
| `notifications_sent_total` | worker | entrega ok |
| `notifications_failed_total` | worker | esgotou retry, foi para a DLQ |
| `notifications_retries_total` | worker | tentativas que foram para wait-queue |
| `notification_webhooks_delivered_total` | worker | callback HTTP 2xx |
| `notification_webhooks_failed_total` | worker | callback esgotou retry ou 410 |
| `notification_delivery_duration_seconds` | worker | criação do pedido -> entrega |
| `notification_attempt_duration_seconds` | worker | duração da chamada ao provedor (`result`: success/retry/failure) |

Fora de `NODE_ENV=test`, a API e o worker também registram `collectDefaultMetrics`
(processo Node).

O Prometheus raspa a cada 5 s:

- `api:3000/metrics`
- `worker:9464/metrics`
- `rabbitmq:15692/metrics`
- `rabbitmq:15692/metrics/per-object` (profundidade por fila)

Grafana em http://localhost:3030, dashboard provisionado em
`docker/grafana/dashboards/notification-gateway.json`: aceitas, enviadas vs
falhas, retries, p95 da latência publicação-envio, profundidade das filas de
trabalho e da `notifications.dead`.

### Logs

Nest `Logger` por classe (`NotificationsService`, `NotificationProcessor`,
`WebhookDispatcher`, provedores, `AmqpService`). SMS/push simulados aparecem
como log no worker, não como e-mail no Mailpit.

## Mini-painel

React em `web/`. Propósito: disparar os templates de exemplo e acompanhar o
status sem curl.

- formulário: destinatário, payload JSON, `callbackUrl` opcional, seletor de
  template (e-mail / SMS / push)
- tabela com polling a cada 2 s, página de 10
- botão de redrive em linha `FAILED`
- botão para drenar a dead-letter do serviço autenticado
- campo de API key (gravado em `localStorage`; default `VITE_API_KEY` /
  `PANEL_API_KEY`)

No Compose o nginx serve o build estático e faz proxy de `/notifications`,
`/auth` e `/health` para `api:3000`. O browser fala só com
http://localhost:8080.

A listagem continua recortada pelo dono da chave: trocar a key no painel muda o
recorte.

## Variáveis de ambiente

Copie `.env.example` para `.env`. O Compose lê o `.env` na raiz. A API/worker
fora do Docker leem as variáveis do processo (e o `.env` do backend, se
existir, via dotenv no seed/data-source).

Validação no boot: `backend/src/config/env.validation.ts` (`class-validator`).
Faltou variável obrigatória ou veio em formato errado, o processo morre na hora
com o nome do campo.

### Compose (raiz `.env`)

| Variável | Default | Uso |
| --- | --- | --- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `notifications` | banco e `DATABASE_URL` interno |
| `POSTGRES_PORT` | `5432` | host |
| `REDIS_PORT` | `6379` | host |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `notifications` | AMQP e management |
| `RABBITMQ_PORT` | `5672` | AMQP |
| `RABBITMQ_MANAGEMENT_PORT` | `15672` | UI |
| `RABBITMQ_PROMETHEUS_PORT` | `15692` | métricas do broker |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT` | `1025` / `8025` | |
| `MAIL_FROM` | `Notification Gateway <no-reply@notifications.local>` | remetente |
| `API_PORT` | `3000` | |
| `WORKER_METRICS_PORT` | `9464` | |
| `PROMETHEUS_PORT` / `GRAFANA_PORT` | `9090` / `3030` | |
| `PANEL_PORT` | `8080` | |
| `PANEL_API_KEY` | chave do billing | build arg `VITE_API_KEY` |
| `API_KEYS` | billing e crm de exemplo | **obrigatório** no Compose (`:?`) |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_SECONDS` | `10` / `60` | |
| `TWILIO_*` / `FCM_*` / `WEBHOOK_SECRET` | vazio | opcionais |

### Processo Node (`DATABASE_URL`, etc.)

Obrigatorias para API e worker:

| Variável | Formato |
| --- | --- |
| `NODE_ENV` | `development`, `production` ou `test` |
| `PORT` | 1–65535 (API; o worker também declara, mas não escuta Nest) |
| `DATABASE_URL` | URL Postgres |
| `REDIS_URL` | URL Redis |
| `RABBITMQ_URL` | `amqp://` ou `amqps://` |
| `API_KEYS` | `nome:chave,...` |
| `SMTP_HOST` / `SMTP_PORT` / `MAIL_FROM` | SMTP |

Opcionais: `METRICS_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`,
`IDEMPOTENCY_TTL_SECONDS`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`,
credenciais Twilio e FCM, `WEBHOOK_SECRET` (mínimo 16 caracteres).

E2e no CI usa `TEST_DATABASE_URL` (banco `notifications_test`), `REDIS_URL` com
DB `1` e `RABBITMQ_URL` local. O script `pretest:e2e` roda `db:run` nesse URL.

## Banco e migrations

Data source: `backend/src/database/data-source.ts` (CLI TypeORM). Opcoes
compartilhadas em `data-source-options.ts` (entidades `Notification`,
`DeliveryAttempt`, `Template`).

```bash
cd backend
npm run db:generate src/database/migrations/NomeDaMudanca
npm run db:run
npm run db:revert
npm run db:seed
```

`db:generate` compara entidades e banco e escreve o SQL. Revise o arquivo antes
de commitar. O que roda em produção é o SQL da pasta `migrations/`, não o
`synchronize`.

O primeiro boot do Postgres executa `docker/postgres/init-test-db.sh` e cria
`notifications_test` no mesmo cluster, para o e2e local.

## Testes e CI

Piramide:

- **Unitários** (`npm test`): regra de negócio com dubles. Fingerprint, rate
  limit, idempotência, processor, templates, topologia, health indicators,
  webhook, provedores simulados. Não sobem Docker.
- **E2e** (`npm run test:e2e`): `AppModule` de verdade + Postgres + Redis +
  RabbitMQ. Prova o contrato HTTP (202, replay, 409, 429, listagem, health,
  métricas). Publisher e e-mail podem ser substituidos por fakes nos testes que
  não querem SMTP real (`backend/test/fake-*.ts`).
- **Cobertura** (`npm run test:cov`): teto 85% linhas/statements/functions e
  75% branches. Abaixo disso o CI falha. Ignora modules, entities, controllers,
  migrations, `main.ts`/`worker.ts`, cliente Redis/AMQP e o HTTP de métricas do
  worker. E2e não entra na cobertura.

Workflow `.github/workflows/ci.yml` (push em `main` e pull request):

1. `quality`: lint (`--max-warnings 0`), `test:cov`, `build` no backend
2. `e2e`: serviços Postgres 17, Redis 7, RabbitMQ 4; `npm run test:e2e`
3. `panel`: `npm ci` + `npm run build` em `web/`
4. `image`: `docker build --target production` do backend e build do painel

Node 22. Cache de npm pelo `package-lock.json` de cada pacote. Concurrency
cancela run anterior no mesmo ref.

## Comandos

No diretorio `backend/`:

```bash
npm run build              # nest build -> dist/
npm run start              # API uma vez
npm run start:dev          # API com watch
npm run start:debug        # API com debugger
npm run start:prod         # node dist/main.js
npm run start:worker       # node dist/worker.js
npm run start:worker:dev   # worker com watch
npm run db:generate        # nova migration (passe o caminho)
npm run db:run             # aplica pendentes
npm run db:revert          # desfaz a última
npm run db:seed            # upsert dos templates de exemplo
npm test                   # unitários
npm run test:watch
npm run test:cov           # unitários + cobertura
npm run test:e2e           # e2e (pretest aplica migrations no banco de teste)
npm run lint               # ESLint + Prettier, zero warnings
npm run lint:fix
npm run format
```

No diretorio `web/`:

```bash
npm run dev                # Vite em :5173
npm run build              # tsc --noEmit && vite build
npm run preview
```

Imagens:

```bash
docker build --target production -t notification-gateway ./backend
docker build -t notification-gateway-panel ./web
```

A imagem de produção do backend roda `node dist/main.js` como usuário `node`.
O worker no Compose sobrescreve o comando para `node dist/worker.js`.

## Operação e problemas comuns

**Compose sobe a API e o worker sem migrar.** O serviço `migrate` precisa
terminar com sucesso. `docker compose logs migrate`. Se o Postgres ainda não
estava healthy, rode de novo o `up`.

**POST devolve 503.** O broker recusou o publish (RabbitMQ fora ou topologia
ainda não declarada). O registro fica `FAILED` com motivo de enqueue. Suba o
Rabbit, confirme `GET /health/ready` e faça redrive.

**E-mail não aparece no Mailpit.** Confira `channel: EMAIL`, o worker rodando, e
a UI em http://localhost:8025. SMS/push não passam pelo Mailpit.

**SMS/push "não enviam".** Sem `TWILIO_*` / `FCM_*` o provedor simula e grava
`SENT` com id `sms-sim-` / `push-sim-`. Isso é o comportamento local esperado.

**429 imediato.** Default 10 / 60 s por destinatário+canal. Espere o
`Retry-After` ou suba `RATE_LIMIT_MAX` no `.env` e recrie os containers da API.

**Listagem vazia com a chave certa.** A listagem é por `requestedBy`. A chave do
crm não vê o que a billing criou. No painel, a key do canto precisa ser a mesma
do POST.

**Redrive 409.** Só `FAILED`. `PENDING`/`PROCESSING`/`SENT` não reprocessam.

**Pronto (`/health/ready`) falha e live passa.** Redis, Postgres, Rabbit ou heap.
O healthcheck do Compose da API usa `/health` (live), não ready.

**Mudança de schema em produção.** Nunca ligue `synchronize`. Gere migration,
revise o SQL, rode `db:run` (no Compose, o serviço `migrate` uma vez por deploy).

**ESM / extensão `.js` nos imports.** Não troque para `.ts` nos `from '...'`.
O compilador `nodenext` resolve `.js` para o arquivo `.ts` na compilação e para
`.js` no `dist/`.
