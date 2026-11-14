import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module.js';
import { API_KEY_HEADER } from '../src/auth/types/api-key.types.js';
import { DeliveryAttemptStatus } from '../src/common/enums/delivery-attempt-status.enum.js';
import { NotificationChannel } from '../src/common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../src/common/enums/notification-status.enum.js';
import { EmailProvider } from '../src/delivery/providers/email.provider.js';
import { NotificationPublisher } from '../src/messaging/publishers/notification.publisher.js';
import { DeliveryAttempt } from '../src/notifications/entities/delivery-attempt.entity.js';
import { Notification } from '../src/notifications/entities/notification.entity.js';
import type { NotificationResponse } from '../src/notifications/mappers/notification.response.js';
import { NotificationProcessor } from '../src/notifications/processors/notification.processor.js';
import { RedisService } from '../src/redis/services/redis.service.js';
import { Template } from '../src/templates/entities/template.entity.js';
import { FakeEmailProvider } from './fake-email.provider.js';
import { TEST_API_KEY, TEST_CLIENT_NAME } from './setup-env.js';

const PEDIDOS = 150;

/**
 * Publisher que, no instante do publish, consulta o banco por OUTRA conexão (um
 * DataSource separado, com o próprio pool). Se a linha ainda não tivesse sido
 * confirmada (commit), ela não apareceria aqui: é a mesma situação de um worker
 * que recebe o id da fila antes de o registro existir.
 */
class VisibilityCheckingPublisher {
  readonly published: Array<{ id: string; channel: NotificationChannel }> = [];
  readonly invisibleAtPublish: string[] = [];

  constructor(private readonly observer: () => DataSource) {}

  async publish(notification: { id: string; channel: NotificationChannel }): Promise<void> {
    const rows = await this.observer().query<unknown[]>(
      'select 1 from notifications where id = $1',
      [notification.id],
    );

    if (rows.length === 0) {
      this.invisibleAtPublish.push(notification.id);
    }

    this.published.push({ id: notification.id, channel: notification.channel });
  }
}

describe('Concorrência (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let dataSource: DataSource;
  let observer: DataSource;
  let processor: NotificationProcessor;
  let redis: RedisService;
  const emailProvider = new FakeEmailProvider();
  const publisher = new VisibilityCheckingPublisher(() => observer);

  beforeAll(async () => {
    observer = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      extra: { max: 2 },
    });
    await observer.initialize();

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
    // Servidor realmente escutando: com centenas de requisições simultâneas, o
    // supertest não pode tentar abrir a porta várias vezes.
    await app.listen(0);
    baseUrl = await app.getUrl();

    dataSource = app.get(DataSource);
    processor = app.get(NotificationProcessor);
    redis = app.get(RedisService);

    await dataSource.getRepository(Template).upsert(
      [
        {
          eventType: 'user.welcome',
          channel: NotificationChannel.EMAIL,
          subject: 'Bem-vindo(a), {{nome}}!',
          body: 'Olá {{nome}}, sua conta em {{produto}} está pronta.',
        },
      ],
      { conflictPaths: ['eventType', 'channel'] },
    );
  });

  beforeEach(async () => {
    await dataSource.getRepository(Notification).deleteAll();
    await redis.flushDb();
    emailProvider.sent.length = 0;
    emailProvider.failNextWith = null;
    emailProvider.failuresRemaining = 0;
    publisher.published.length = 0;
    publisher.invisibleAtPublish.length = 0;
  });

  afterAll(async () => {
    await dataSource.getRepository(Notification).deleteAll();
    await app.close();
    await observer.destroy();
  });

  function postNotification(i: number) {
    // Destinatário único por pedido: o rate limit é por destinatário e não deve
    // interferir no que o teste mede.
    return request(baseUrl)
      .post('/notifications')
      .set(API_KEY_HEADER, TEST_API_KEY)
      .send({
        channel: 'EMAIL',
        eventType: 'user.welcome',
        recipient: `par-${i}@exemplo.com`,
        payload: { nome: `Pessoa ${i}`, produto: 'Gateway' },
      });
  }

  async function createInParallel(count: number): Promise<NotificationResponse[]> {
    const responses = await Promise.all(
      Array.from({ length: count }, (_, i) => postNotification(i)),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(count).fill(202));

    return responses.map((response) => response.body as NotificationResponse);
  }

  it('pedidos simultâneos: cada 202 vira uma linha, publicada uma vez e já visível', async () => {
    const notifications = await createInParallel(PEDIDOS);
    const ids = new Set(notifications.map((notification) => notification.id));

    expect(ids.size).toBe(PEDIDOS);

    // O cache de template é compartilhado entre os pedidos: nenhum pode receber o
    // conteúdo de outro.
    notifications.forEach((notification, i) => {
      expect(notification.subject).toBe(`Bem-vindo(a), Pessoa ${i}!`);
      expect(notification.recipient).toBe(`par-${i}@exemplo.com`);
      expect(notification.status).toBe('PENDING');
      expect(notification.attempts).toEqual([]);
    });

    const rows = await dataSource.getRepository(Notification).find({
      where: { requestedBy: TEST_CLIENT_NAME },
    });

    expect(rows).toHaveLength(PEDIDOS);
    expect(new Set(rows.map((row) => row.id))).toEqual(ids);
    expect(rows.every((row) => row.status === NotificationStatus.PENDING)).toBe(true);
    expect(rows.every((row) => row.templateId !== null)).toBe(true);

    expect(publisher.published).toHaveLength(PEDIDOS);
    expect(new Set(publisher.published.map((message) => message.id))).toEqual(ids);

    // A garantia que importa: quando o id foi para a fila, a linha já estava
    // confirmada no banco e visível para outra conexão.
    expect(publisher.invisibleAtPublish).toEqual([]);
  });

  it('worker concorrente: cada notificação é entregue uma única vez', async () => {
    const notifications = await createInParallel(PEDIDOS);

    const results = await Promise.all(
      notifications.map((notification) => processor.process(notification.id)),
    );

    expect(results.every((result) => result.kind === 'sent')).toBe(true);
    expect(emailProvider.sent).toHaveLength(PEDIDOS);
    expect(new Set(emailProvider.sent.map((sent) => sent.recipient)).size).toBe(PEDIDOS);

    const rows = await dataSource.getRepository(Notification).find({
      where: { requestedBy: TEST_CLIENT_NAME },
    });
    expect(rows.every((row) => row.status === NotificationStatus.SENT)).toBe(true);

    const attempts = await dataSource.getRepository(DeliveryAttempt).find();
    expect(attempts).toHaveLength(PEDIDOS);
    expect(new Set(attempts.map((attempt) => attempt.notificationId)).size).toBe(PEDIDOS);
    expect(attempts.every((attempt) => attempt.status === DeliveryAttemptStatus.SUCCESS)).toBe(
      true,
    );
  });

  it('a mesma mensagem processada duas vezes ao mesmo tempo gera um único envio', async () => {
    const duplicadas = 50;
    const notifications = await createInParallel(duplicadas);

    await Promise.all(
      notifications.flatMap((notification) => [
        processor.process(notification.id),
        processor.process(notification.id),
      ]),
    );

    expect(emailProvider.sent).toHaveLength(duplicadas);
    expect(new Set(emailProvider.sent.map((sent) => sent.recipient)).size).toBe(duplicadas);
  });
});
