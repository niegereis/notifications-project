// Teste de carga do POST /notifications.
//
// Dois cenários rodam juntos:
//   - ingest: modelo aberto (ramping-arrival-rate). Dispara N req/s independente
//     da latência da API, que é o que um sistema chamador real faz. Mede só a
//     aceitação (202), sem esperar a entrega.
//   - e2e: poucas notificações por segundo; cada uma faz POST e depois consulta
//     GET /notifications/:id até virar SENT ou FAILED. Mede o tempo entre o 202 e
//     o desfecho, que é onde a fila e o worker aparecem.
//
// Variáveis (todas opcionais):
//   BASE_URL        http://localhost:3000
//   API_KEY         chave de um serviço em API_KEYS
//   TARGETS         taxas de cada degrau em req/s, ex.: 50,200,500,1000
//   STAGE_DURATION  duração de cada degrau, ex.: 1m
//   E2E_RATE        notificações/s do cenário e2e (0 desliga). Default 2
//   E2E_TIMEOUT_S   quanto esperar pelo desfecho antes de desistir. Default 120
//   SMOKE=1         rodada curta (10s a 5 req/s) para validar o script

import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';
const SMOKE = __ENV.SMOKE === '1';
const TARGETS = (__ENV.TARGETS || '50,200,500,1000').split(',').map(Number);
const STAGE_DURATION = __ENV.STAGE_DURATION || '1m';
const E2E_RATE = Number(__ENV.E2E_RATE ?? 2);
const E2E_TIMEOUT_S = Number(__ENV.E2E_TIMEOUT_S ?? 120);

// Distingue execuções para que destinatários de rodadas diferentes não colidam
// com o rate limit (que conta por canal+destinatário dentro da janela).
const RUN_ID = Date.now().toString(36);

const accepted = new Counter('notifications_accepted');
const rateLimited = new Counter('notifications_rate_limited');
const rejected = new Counter('notifications_rejected');
const deliveredOk = new Rate('e2e_delivered_sent');
const e2eLatency = new Trend('e2e_accept_to_final_ms', true);
const e2eTimeouts = new Counter('e2e_timeouts');

if (!API_KEY && !SMOKE) {
  console.warn('API_KEY vazio: as requisições vão voltar 401. Defina API_KEY.');
}

function buildScenarios() {
  if (SMOKE) {
    return {
      ingest: {
        executor: 'constant-arrival-rate',
        rate: 5,
        timeUnit: '1s',
        duration: '10s',
        preAllocatedVUs: 5,
        maxVUs: 20,
        exec: 'ingest',
      },
    };
  }

  const scenarios = {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 3000,
      stages: TARGETS.flatMap((target) => [
        { target, duration: '15s' }, // sobe até o degrau
        { target, duration: STAGE_DURATION }, // segura
      ]),
      exec: 'ingest',
    },
  };

  if (E2E_RATE > 0) {
    const totalSeconds = TARGETS.length * (15 + toSeconds(STAGE_DURATION));
    scenarios.e2e = {
      executor: 'constant-arrival-rate',
      rate: E2E_RATE,
      timeUnit: '1s',
      duration: `${totalSeconds}s`,
      preAllocatedVUs: Math.ceil(E2E_RATE * 10),
      maxVUs: Math.ceil(E2E_RATE * 60),
      exec: 'e2e',
    };
  }

  return scenarios;
}

function toSeconds(duration) {
  const match = /^(\d+)(s|m|h)$/.exec(duration);
  if (!match) throw new Error(`STAGE_DURATION inválida: ${duration} (use 30s, 1m, 1h)`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

export const options = {
  scenarios: buildScenarios(),
  thresholds: {
    // Aceitar o pedido tem que ser rápido e quase nunca falhar.
    'http_req_duration{name:create}': ['p(95)<500', 'p(99)<1500'],
    'http_req_failed{name:create}': ['rate<0.01'],
    // Se isso disparar, o rate limit está mascarando o teste (veja README do loadtest).
    notifications_rate_limited: ['count==0'],
    notifications_rejected: ['count==0'],
    // O worker precisa escoar a fila em tempo razoável.
    e2e_accept_to_final_ms: ['p(95)<10000'],
    e2e_timeouts: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const headers = {
  'Content-Type': 'application/json',
  'x-api-key': API_KEY,
};

// Os três canais usam o template order.shipped do seed.
function payloadFor(n) {
  const channel = ['EMAIL', 'SMS', 'PUSH'][n % 3];
  const id = `${RUN_ID}-${n}`;

  const recipient = {
    EMAIL: `lt-${id}@loadtest.local`,
    // E.164 válido: +55 11 9 + 8 dígitos derivados do contador. Repete a cada
    // 100 milhões de pedidos, bem além do que qualquer rodada gera.
    SMS: `+55119${String(n % 100000000).padStart(8, '0')}`,
    PUSH: `fcm-token-${id}-0000000000`,
  }[channel];

  return {
    channel,
    eventType: 'order.shipped',
    recipient,
    payload: {
      nome: `Cliente ${n}`,
      numeroPedido: `LT-${id}`,
      prazo: '2026-12-31',
      rastreio: `BR${String(n).padStart(10, '0')}`,
    },
  };
}

function post(body) {
  return http.post(`${BASE_URL}/notifications`, JSON.stringify(body), {
    headers,
    tags: { name: 'create' },
  });
}

function record(res) {
  if (res.status === 202) {
    accepted.add(1);
  } else if (res.status === 429) {
    rateLimited.add(1);
  } else {
    rejected.add(1);
  }
  return check(res, { 'POST retornou 202': (r) => r.status === 202 });
}

export function ingest() {
  const res = post(payloadFor(exec.scenario.iterationInTest));
  record(res);
}

export function e2e() {
  // Offset alto para não repetir destinatários do cenário ingest.
  const n = 1_000_000_000 + exec.scenario.iterationInTest;
  const startedAt = Date.now();
  const res = post(payloadFor(n));

  if (!record(res)) return;

  const id = res.json('id');
  const deadline = startedAt + E2E_TIMEOUT_S * 1000;

  while (Date.now() < deadline) {
    sleep(0.2); // granularidade da medição e2e: valores abaixo disso são ruído

    const poll = http.get(`${BASE_URL}/notifications/${id}`, {
      headers,
      tags: { name: 'poll' },
    });
    if (poll.status !== 200) continue;

    const status = poll.json('status');
    if (status === 'SENT' || status === 'FAILED') {
      e2eLatency.add(Date.now() - startedAt);
      deliveredOk.add(status === 'SENT');
      return;
    }
  }

  e2eTimeouts.add(1);
}
