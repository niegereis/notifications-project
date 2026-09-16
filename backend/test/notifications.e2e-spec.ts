import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { API_KEY_HEADER } from '../src/auth/types/api-key.types.js';
import { NotificationChannel } from '../src/common/enums/notification-channel.enum.js';
import { EmailProvider } from '../src/delivery/providers/email.provider.js';
import { NotificationPublisher } from '../src/messaging/publishers/notification.publisher.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import { NotificationProcessor } from '../src/notifications/processors/notification.processor.js';
import type { NotificationResponse } from '../src/notifications/mappers/notification.response.js';
import { RedisService } from '../src/redis/services/redis.service.js';
import { Template } from '../src/templates/entities/template.entity.js';
import { signWebhookBody } from '../src/webhooks/services/webhook.dispatcher.js';
import { FakeEmailProvider } from './fake-email.provider.js';
import { FakeNotificationPublisher } from './fake-notification.publisher.js';
import { OTHER_API_KEY, TEST_API_KEY, TEST_CLIENT_NAME } from './setup-env.js';

function notificationOf(response: request.Response): NotificationResponse {
  return response.body as NotificationResponse;
}

function errorMessageOf(response: request.Response): string {
  return JSON.stringify((response.body as { message?: unknown }).message);
}

describe('Notificações (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let dataSource: DataSource;
  let processor: NotificationProcessor;
  let redis: RedisService;
  const emailProvider = new FakeEmailProvider();
  const publisher = new FakeNotificationPublisher();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmailProvider)
      .useValue(emailProvider)
      .overrideProvider(NotificationPublisher)
      .useValue(publisher)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    server = app.getHttpServer() as Server;
    dataSource = app.get(DataSource);
    processor = app.get(NotificationProcessor);
    redis = app.get(RedisService);

    const template = {
      subject: 'Bem-vindo(a), {{nome}}!',
      body: 'Olá {{nome}}, sua conta em {{produto}} está pronta.',
    };

    await dataSource.getRepository(Template).upsert(
      [
        { eventType: 'user.welcome', channel: NotificationChannel.EMAIL, ...template },
        {
          eventType: 'order.shipped',
          channel: NotificationChannel.SMS,
          subject: null,
          body: 'Seu pedido {{numeroPedido}} saiu para entrega. Rastreio: {{rastreio}}.',
        },
      ],
      {
        conflictPaths: ['eventType', 'channel'],
      },
    );
  });

  beforeEach(async () => {
    await dataSource.getRepository(Notification).deleteAll();
    await redis.flushDb();
    emailProvider.sent.length = 0;
    emailProvider.failNextWith = null;
    emailProvider.failuresRemaining = 0;
    publisher.published.length = 0;
    publisher.failNextWith = null;
  });

  afterAll(async () => {
    await dataSource.getRepository(Notification).deleteAll();
    await app.close();
  });

  const validBody = {
    channel: 'EMAIL',
    eventType: 'user.welcome',
    recipient: 'ana@exemplo.com',
    payload: { nome: 'Ana', produto: 'Gateway' },
  };

  function postNotification(body: Record<string, unknown>, apiKey = TEST_API_KEY) {
    return request(server).post('/notifications').set(API_KEY_HEADER, apiKey).send(body);
  }

  it('aceita o pedido e devolve 202 com status pending', async () => {
    const notification = notificationOf(await postNotification(validBody).expect(202));

    expect(notification).toMatchObject({
      channel: 'EMAIL',
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      status: 'PENDING',
      requestedBy: TEST_CLIENT_NAME,
      subject: 'Bem-vindo(a), Ana!',
      body: 'Olá Ana, sua conta em Gateway está pronta.',
    });
    expect(notification.attempts).toEqual([]);
    expect(publisher.published).toEqual([
      { id: notification.id, channel: NotificationChannel.EMAIL },
    ]);
  });

  it('o worker entrega e o GET mostra o histórico da tentativa', async () => {
    const created = notificationOf(await postNotification(validBody).expect(202));

    await processor.process(created.id);

    const found = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(found).toMatchObject({
      status: 'SENT',
      requestedBy: TEST_CLIENT_NAME,
    });
    expect(found.attempts).toHaveLength(1);
    expect(found.attempts?.[0]).toMatchObject({
      attemptNumber: 1,
      status: 'SUCCESS',
      providerMessageId: 'fake-1',
    });
  });

  it('entrega ao provedor o conteúdo já renderizado', async () => {
    const created = notificationOf(await postNotification(validBody).expect(202));

    await processor.process(created.id);

    expect(emailProvider.sent).toEqual([
      {
        recipient: 'ana@exemplo.com',
        subject: 'Bem-vindo(a), Ana!',
        body: 'Olá Ana, sua conta em Gateway está pronta.',
      },
    ]);
  });

  it('registra a falha do provedor e permanece em processing para retry', async () => {
    emailProvider.failNextWith = 'Provedor de e-mail recusou o envio: conexão recusada';

    const created = notificationOf(await postNotification(validBody).expect(202));
    await processor.process(created.id);

    const found = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(found.status).toBe('PROCESSING');
    expect(found.failureReason).toContain('conexão recusada');
    expect(found.attempts?.[0]).toMatchObject({ status: 'FAILURE' });
  });

  it('marca como failed depois de esgotar as tentativas', async () => {
    emailProvider.failNextWith = 'Provedor de e-mail recusou o envio: conexão recusada';
    emailProvider.failuresRemaining = 3;

    const created = notificationOf(await postNotification(validBody).expect(202));
    await processor.process(created.id);
    await processor.process(created.id);
    await processor.process(created.id);

    const found = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(found.status).toBe('FAILED');
    expect(found.attempts).toHaveLength(3);
    expect(found.attempts?.every((attempt) => attempt.status === 'FAILURE')).toBe(true);
  });

  it('consulta a notificação pelo id enquanto ainda está pendente', async () => {
    const created = notificationOf(await postNotification(validBody).expect(202));

    const found = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(found.id).toBe(created.id);
    expect(found.status).toBe('PENDING');
  });

  it('não deixa um serviço ler a notificação de outro', async () => {
    const created = notificationOf(await postNotification(validBody).expect(202));

    await request(server)
      .get(`/notifications/${created.id}`)
      .set(API_KEY_HEADER, OTHER_API_KEY)
      .expect(404);
  });

  it('devolve 503 quando não consegue enfileirar', async () => {
    publisher.failNextWith = 'conexão recusada';

    await postNotification(validBody).expect(503);
  });

  it('recusa evento sem template no canal', async () => {
    await postNotification({ ...validBody, eventType: 'evento.inexistente' }).expect(422);
  });

  it('recusa payload sem as variáveis do template', async () => {
    const response = await postNotification({ ...validBody, payload: { nome: 'Ana' } }).expect(422);

    expect(errorMessageOf(response)).toContain('produto');
  });

  it('recusa destinatário que não combina com o canal', async () => {
    await postNotification({ ...validBody, recipient: 'nao-e-email' }).expect(400);
  });

  it('aceita SMS e o worker entrega pela estratégia do canal', async () => {
    const created = notificationOf(
      await postNotification({
        channel: 'SMS',
        eventType: 'order.shipped',
        recipient: '+5511999999999',
        payload: { numeroPedido: 'PED-1', rastreio: 'BR123' },
      }).expect(202),
    );

    expect(created.status).toBe('PENDING');
    expect(publisher.published[0]).toMatchObject({ channel: NotificationChannel.SMS });

    await processor.process(created.id);

    const found = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(found.status).toBe('SENT');
    expect(found.attempts?.[0]?.providerMessageId).toMatch(/^sms-sim-/);
  });

  it('recusa campo desconhecido no corpo', async () => {
    await postNotification({ ...validBody, prioridade: 'alta' }).expect(400);
  });

  it('exige API key', async () => {
    await request(server).post('/notifications').send(validBody).expect(401);
  });

  it('repete o mesmo pedido quando a Idempotency-Key é reenviada', async () => {
    const first = notificationOf(
      await postNotification(validBody).set('Idempotency-Key', 'pedido-42').expect(202),
    );
    const second = notificationOf(
      await postNotification(validBody).set('Idempotency-Key', 'pedido-42').expect(202),
    );

    expect(second.id).toBe(first.id);
    expect(publisher.published).toHaveLength(1);
  });

  it('recusa a mesma Idempotency-Key com corpo diferente', async () => {
    await postNotification(validBody).set('Idempotency-Key', 'pedido-42').expect(202);

    await postNotification({ ...validBody, recipient: 'bruno@exemplo.com' })
      .set('Idempotency-Key', 'pedido-42')
      .expect(409);
  });

  it('limita envios repetidos para o mesmo destinatário', async () => {
    await postNotification(validBody).expect(202);
    await postNotification(validBody).expect(202);
    await postNotification(validBody).expect(202);

    const limited = await postNotification(validBody).expect(429);

    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('lista com filtro e paginação, só do serviço autenticado', async () => {
    await postNotification(validBody).expect(202);
    await postNotification({ ...validBody, recipient: 'bruno@exemplo.com' }).expect(202);
    await postNotification({
      channel: 'SMS',
      eventType: 'order.shipped',
      recipient: '+5511999999999',
      payload: { numeroPedido: 'PED-1', rastreio: 'BR123' },
    }).expect(202);

    const listed = await request(server)
      .get('/notifications')
      .query({ channel: 'EMAIL', page: 1, pageSize: 1 })
      .set(API_KEY_HEADER, TEST_API_KEY)
      .expect(200);

    const body = listed.body as { items: NotificationResponse[]; total: number; pageSize: number };

    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.pageSize).toBe(1);
    expect(body.items[0]?.channel).toBe('EMAIL');

    await request(server)
      .get('/notifications')
      .set(API_KEY_HEADER, OTHER_API_KEY)
      .expect(200)
      .expect((response) => {
        expect((response.body as { total: number }).total).toBe(0);
      });
  });

  it('POSTa o desfecho no callbackUrl quando a entrega termina', async () => {
    const hits: Array<{ raw: string; signature?: string; timestamp?: string }> = [];

    const webhookServer = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        hits.push({
          raw: Buffer.concat(chunks).toString(),
          signature: request.headers['x-webhook-signature'] as string | undefined,
          timestamp: request.headers['x-webhook-timestamp'] as string | undefined,
        });
        response.writeHead(200).end();
      });
    });

    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
    const port = (webhookServer.address() as AddressInfo).port;

    try {
      const created = notificationOf(
        await postNotification({
          ...validBody,
          callbackUrl: `http://127.0.0.1:${port}/hooks`,
        }).expect(202),
      );

      expect(created.callbackUrl).toBe(`http://127.0.0.1:${port}/hooks`);

      await processor.process(created.id);

      expect(hits).toHaveLength(1);
      expect(JSON.parse(hits[0]?.raw ?? '{}')).toMatchObject({ id: created.id, status: 'SENT' });
      expect(hits[0]?.signature).toBe(
        `sha256=${signWebhookBody('webhook-test-secret', hits[0]?.timestamp ?? '', hits[0]?.raw ?? '')}`,
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        webhookServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('reprocessa uma FAILED e entrega no ciclo seguinte', async () => {
    emailProvider.failNextWith = 'Provedor de e-mail recusou o envio: conexão recusada';
    emailProvider.failuresRemaining = 3;

    const created = notificationOf(await postNotification(validBody).expect(202));
    await processor.process(created.id);
    await processor.process(created.id);
    await processor.process(created.id);

    const failed = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );
    expect(failed.status).toBe('FAILED');

    await request(server)
      .post(`/notifications/${created.id}/redrive`)
      .set(API_KEY_HEADER, OTHER_API_KEY)
      .expect(404);

    const redriven = notificationOf(
      await request(server)
        .post(`/notifications/${created.id}/redrive`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(202),
    );

    expect(redriven.status).toBe('PENDING');
    expect(publisher.published).toHaveLength(2);

    emailProvider.failNextWith = null;
    await processor.process(created.id);

    const sent = notificationOf(
      await request(server)
        .get(`/notifications/${created.id}`)
        .set(API_KEY_HEADER, TEST_API_KEY)
        .expect(200),
    );

    expect(sent.status).toBe('SENT');
    expect(sent.attempts).toHaveLength(4);
  });
});
