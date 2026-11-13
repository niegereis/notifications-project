#!/usr/bin/env bash
# Roda uma rodada completa do teste de carga e guarda toda a evidência em
# loadtest/results/. Existe porque, nas rodadas anteriores, a captura de CPU e a
# checagem do prefetch dependiam de lembrar de fazê-las à mão.
#
# Uso:   loadtest/run-round.sh rodada-6
# Antes: o stack precisa estar de pé (veja loadtest/README.md). Para a rodada com
#        réplicas, exporte COMPOSE_FILE=docker-compose.yml:docker-compose.scale.yml.
#
# Gera em loadtest/results/:
#   <nome>.json        resumo do k6 (--summary-export)
#   k6-<nome>.txt      saída do k6 (resumo e thresholds)
#   stats-<nome>.txt   docker stats de todos os containers a cada ~5 s
#   db-<nome>.txt      criadas/entregues por minuto, status e filas ao fim da rampa
set -uo pipefail

cd "$(dirname "$0")/.."

NAME="${1:?uso: loadtest/run-round.sh <nome>   (ex.: rodada-6)}"
OUT="loadtest/results"
RABBIT="http://localhost:15672/api"
RABBIT_AUTH="${RABBITMQ_USER:-notifications}:${RABBITMQ_PASSWORD:-notifications}"
PSQL=(docker compose exec -T postgres psql -U "${POSTGRES_USER:-notifications}" -d "${POSTGRES_DB:-notifications}")

mkdir -p "$OUT"

echo "== Pré-checagens =="

API_COUNT=$(docker compose ps api -q | wc -l | tr -d ' ')
echo "Réplicas da API no ar: $API_COUNT"
if [ "$API_COUNT" -lt 1 ]; then
  echo "ERRO: nenhuma réplica da API rodando. Suba o stack antes." >&2
  exit 1
fi

# prefetch_count = 0 significa "sem limite" (foi o que aconteceu na rodada 3).
CONSUMERS=$(curl -sf -u "$RABBIT_AUTH" "$RABBIT/consumers") || {
  echo "ERRO: não consegui ler os consumidores do RabbitMQ em $RABBIT." >&2
  exit 1
}
echo "$CONSUMERS" | python3 -c "
import json, sys
consumers = json.load(sys.stdin)
if not consumers:
    sys.exit('ERRO: nenhum consumidor registrado. O worker subiu?')
bad = False
for c in sorted(consumers, key=lambda c: c['queue']['name']):
    print(f\"  {c['queue']['name']}: prefetch_count = {c['prefetch_count']}\")
    bad = bad or c['prefetch_count'] == 0
if bad:
    sys.exit('ERRO: prefetch_count = 0 (sem limite). Defina CONSUMER_PREFETCH no .env e recrie o worker.')
" || exit 1

echo "Mailpit/Postgres/Redis: $(docker compose ps --format '{{.Service}}={{.Health}}' postgres redis rabbitmq mailpit | tr '\n' ' ')"

# pg_stat_statements só existe com o override docker-compose.profiling.yml.
PGSS=0
if "${PSQL[@]}" -tAc "show shared_preload_libraries" 2>/dev/null | grep -q pg_stat_statements; then
  "${PSQL[@]}" -q -c "create extension if not exists pg_stat_statements;" >/dev/null
  "${PSQL[@]}" -q -tAc "select pg_stat_statements_reset();" >/dev/null
  PGSS=1
  echo "pg_stat_statements: ativo e zerado"
else
  echo "pg_stat_statements: desligado (use docker-compose.profiling.yml para ver as consultas)"
fi
echo

echo "== Rodando $NAME =="
STATS_FILE="$OUT/stats-$NAME.txt"
: > "$STATS_FILE"
(
  while true; do
    echo "# $(date +%H:%M:%S)"
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}'
    sleep 3
  done
) >> "$STATS_FILE" 2>&1 &
STATS_PID=$!
trap 'kill "$STATS_PID" 2>/dev/null || true' EXIT

docker compose --profile loadtest run --rm k6 run --quiet --log-output=none \
  --summary-export="/results/$NAME.json" /scripts/post-notifications.js \
  2>&1 | tee "$OUT/k6-$NAME.txt"
K6_RC=${PIPESTATUS[0]}

kill "$STATS_PID" 2>/dev/null || true
wait "$STATS_PID" 2>/dev/null || true

echo
echo "== Coletando evidência (k6 saiu com código $K6_RC) =="
DB_FILE="$OUT/db-$NAME.txt"
{
  echo "# Coletado em $(date '+%F %T')"
  echo
  echo "## Filas logo ao fim da rampa (ready = backlog)"
  curl -s -u "$RABBIT_AUTH" "$RABBIT/queues" | python3 -c "
import json, sys
for q in sorted(json.load(sys.stdin), key=lambda q: q['name']):
    if q['name'] in ('notifications.email', 'notifications.sms', 'notifications.push', 'notifications.dead'):
        rate = q.get('message_stats', {}).get('deliver_get_details', {}).get('rate')
        print(f\"{q['name']:<22} ready={q['messages_ready']:<8} unacked={q['messages_unacknowledged']:<5} deliver/s={rate}\")
"
  echo
  echo "## Criadas por minuto (taxa aceita pela API) e e-mails entregues por minuto"
  "${PSQL[@]}" -c "
    select m, criadas, round(criadas/60.0) as por_s, email_entregues
    from (
      select date_trunc('minute', created_at) m, count(*) criadas
      from notifications group by 1
    ) c
    left join (
      select date_trunc('minute', sent_at) ms, count(*) email_entregues
      from notifications where channel = 'EMAIL' and sent_at is not null group by 1
    ) e on e.ms = c.m
    order by m;"
  echo
  echo "## Status por canal"
  "${PSQL[@]}" -c "select channel, status, count(*) from notifications group by 1,2 order by 1,2;"
  if [ "$PGSS" = 1 ]; then
    echo
    echo "## Custo no Postgres por notificação criada (pg_stat_statements)"
    "${PSQL[@]}" -c "
      with s as (
        select * from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
          and query not ilike '%pg_stat_statements%'
      ), n as (select count(*)::numeric as total from notifications)
      select n.total as notificacoes,
             sum(s.calls) as consultas,
             round(sum(s.calls) / n.total, 2) as consultas_por_notif,
             round((sum(s.total_exec_time) / n.total)::numeric, 3) as ms_de_banco_por_notif
      from s, n group by n.total;"
    echo
    echo "## Consultas mais caras por tempo total"
    "${PSQL[@]}" -c "
      with s as (
        select * from pg_stat_statements
        where dbid = (select oid from pg_database where datname = current_database())
          and query not ilike '%pg_stat_statements%'
      ), n as (select count(*)::numeric as total from notifications)
      select left(regexp_replace(s.query, '\s+', ' ', 'g'), 100) as consulta,
             s.calls,
             round(s.calls / n.total, 2) as por_notif,
             round(s.total_exec_time::numeric / 1000, 1) as total_s,
             round(s.mean_exec_time::numeric, 3) as medio_ms,
             round((100 * s.total_exec_time / sum(s.total_exec_time) over ())::numeric, 1) as pct
      from s, n order by s.total_exec_time desc limit 14;"
  fi
} > "$DB_FILE" 2>&1
cat "$DB_FILE"

echo
echo "== CPU de pico por container (de $STATS_FILE) =="
python3 - "$STATS_FILE" <<'PY'
import re, sys
peak = {}
for line in open(sys.argv[1]):
    m = re.match(r"(\S+) cpu=([\d.]+)%", line)
    if m:
        peak[m.group(1)] = max(peak.get(m.group(1), 0.0), float(m.group(2)))
for name, cpu in sorted(peak.items(), key=lambda kv: -kv[1]):
    print(f"  {name:<40} {cpu:>7.1f}%   (100% = 1 núcleo)")
PY

echo
echo "Arquivos: $OUT/$NAME.json  $OUT/k6-$NAME.txt  $OUT/stats-$NAME.txt  $DB_FILE"
exit "$K6_RC"
