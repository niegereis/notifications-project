import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { DeliveryService } from '../../delivery/services/delivery.service.js';
import { AmqpService } from '../../messaging/services/amqp.service.js';
import { NotificationPublisher } from '../../messaging/publishers/notification.publisher.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';
import { TemplatesService } from '../../templates/services/templates.service.js';
import type { CreateNotificationDto } from '../dto/create-notification.dto.js';
import { IdempotencyService } from './idempotency.service.js';
import { Notification } from '../entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';
import { RateLimitService } from './rate-limit.service.js';

const dto: CreateNotificationDto = {
  channel: NotificationChannel.EMAIL,
  eventType: 'user.welcome',
  recipient: 'ana@exemplo.com',
  payload: { nome: 'Ana', produto: 'Gateway' },
};

const NOTIFICATION_ID = '1e6f5d6a-0d3d-4f1a-9c62-2a3a7b1f9c11';

interface Harness {
  service: NotificationsService;
  created: Record<string, unknown>[];
  published: Array<{ id: string; channel: NotificationChannel }>;
  updates: Record<string, unknown>[];
  rateLimited: Array<{ channel: NotificationChannel; recipient: string }>;
  returnedDead: Array<{ notificationId: string }>;
}

function buildHarness(
  options: {
    supports?: boolean;
    publishFails?: boolean;
    replayId?: string;
    status?: NotificationStatus;
    dead?: Array<{ notificationId: string; channel: NotificationChannel }>;
  } = {},
): Harness {
  const created: Record<string, unknown>[] = [];
  const published: Array<{ id: string; channel: NotificationChannel }> = [];
  const updates: Record<string, unknown>[] = [];
  const rateLimited: Array<{ channel: NotificationChannel; recipient: string }> = [];
  const returnedDead: Array<{ notificationId: string }> = [];

  const persisted = {
    id: NOTIFICATION_ID,
    channel: NotificationChannel.EMAIL,
    recipient: dto.recipient,
    subject: 'Bem-vindo(a), Ana!',
    body: 'Olá Ana',
    status: options.status ?? NotificationStatus.PENDING,
    requestedBy: 'billing',
    failureReason: options.status === NotificationStatus.FAILED ? 'esgotou retries' : null,
    deliveryCycle: 0,
    callbackUrl: null,
    attempts: [],
  };

  const notifications = {
    create: (data: Record<string, unknown>) => data,
    save: (data: Record<string, unknown>) => {
      created.push(data);
      return Promise.resolve(persisted);
    },
    update: (_criteria: unknown, data: Record<string, unknown>) => {
      updates.push(data);
      Object.assign(persisted, data);
      return Promise.resolve({ affected: 1 });
    },
    findOne: (args?: { where?: { requestedBy?: string; id?: string } }) => {
      if (args?.where?.id === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee') {
        return Promise.resolve({
          ...persisted,
          id: args.where.id,
          requestedBy: 'crm',
          status: NotificationStatus.FAILED,
          channel: NotificationChannel.SMS,
        });
      }

      if (args?.where?.requestedBy && args.where.requestedBy !== 'billing') {
        return Promise.resolve(null);
      }

      if (args?.where?.id && args.where.id !== persisted.id) {
        return Promise.resolve(null);
      }

      return Promise.resolve({ ...persisted, id: args?.where?.id ?? persisted.id });
    },
    findAndCount: () => Promise.resolve([[persisted], 1]),
  } as unknown as Repository<Notification>;

  const templates = {
    renderForEvent: () =>
      Promise.resolve({
        templateId: 'b6b1f7f4-0f38-4e4e-9a55-9d2f1b6a7c10',
        subject: 'Bem-vindo(a), Ana!',
        body: 'Olá Ana',
      }),
  } as unknown as TemplatesService;

  const delivery = {
    supports: () => options.supports ?? true,
  } as unknown as DeliveryService;

  const publisher = {
    publish: (notification: { id: string; channel: NotificationChannel }) => {
      if (options.publishFails) {
        return Promise.reject(new Error('conexão recusada'));
      }

      published.push({ id: notification.id, channel: notification.channel });
      return Promise.resolve();
    },
  } as unknown as NotificationPublisher;

  const idempotency = {
    reserve: () =>
      options.replayId
        ? Promise.resolve({ kind: 'replay', notificationId: options.replayId })
        : Promise.resolve({ kind: 'acquired' }),
    commit: () => Promise.resolve(),
    release: () => Promise.resolve(),
  } as unknown as IdempotencyService;

  const rateLimit = {
    consume: (channel: NotificationChannel, recipient: string) => {
      rateLimited.push({ channel, recipient });
      return Promise.resolve();
    },
  } as unknown as RateLimitService;

  const metrics = {
    recordAccepted: () => undefined,
    recordReplay: () => undefined,
    recordEnqueueFailed: () => undefined,
    recordRedriven: () => undefined,
  } as unknown as MetricsService;

  const amqp = {
    pullDead: () => Promise.resolve(options.dead ?? []),
    publishDead: (message: { notificationId: string }) => {
      returnedDead.push(message);
      return Promise.resolve();
    },
  } as unknown as AmqpService;

  return {
    service: new NotificationsService(
      notifications,
      templates,
      delivery,
      publisher,
      idempotency,
      rateLimit,
      metrics,
      amqp,
    ),
    created,
    published,
    updates,
    rateLimited,
    returnedDead,
  };
}

describe('NotificationsService', () => {
  it('registra a notificação com o conteúdo renderizado e o serviço que pediu', async () => {
    const { service, created } = buildHarness();

    await service.create(dto, 'billing');

    expect(created[0]).toMatchObject({
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      requestedBy: 'billing',
      subject: 'Bem-vindo(a), Ana!',
      status: NotificationStatus.PENDING,
    });
  });

  it('publica o id na exchange em vez de entregar na hora', async () => {
    const { service, published } = buildHarness();

    const notification = await service.create(dto, 'billing');

    expect(published).toEqual([{ id: NOTIFICATION_ID, channel: NotificationChannel.EMAIL }]);
    expect(notification.status).toBe(NotificationStatus.PENDING);
  });

  it('cobra o destinatário no rate limit em pedido novo', async () => {
    const { service, rateLimited } = buildHarness();

    await service.create(dto, 'billing');

    expect(rateLimited).toEqual([
      { channel: NotificationChannel.EMAIL, recipient: 'ana@exemplo.com' },
    ]);
  });

  it('repete o pedido anterior sem criar outro quando a Idempotency-Key bate', async () => {
    const { service, created, rateLimited } = buildHarness({ replayId: NOTIFICATION_ID });

    const notification = await service.create(dto, 'billing', 'pedido-1');

    expect(notification.id).toBe(NOTIFICATION_ID);
    expect(created).toEqual([]);
    expect(rateLimited).toEqual([]);
  });

  it('marca como falha e devolve 503 quando a publicação recusa', async () => {
    const { service, updates } = buildHarness({ publishFails: true });

    await expect(service.create(dto, 'billing')).rejects.toThrow(ServiceUnavailableException);
    expect(updates[0]).toMatchObject({
      status: NotificationStatus.FAILED,
    });
  });

  it('recusa canal sem provedor configurado', async () => {
    const { service, published } = buildHarness({ supports: false });

    await expect(
      service.create({ ...dto, channel: NotificationChannel.SMS }, 'billing'),
    ).rejects.toThrow(UnprocessableEntityException);
    expect(published).toEqual([]);
  });

  it('não entrega notificação de outro serviço', async () => {
    const { service } = buildHarness();

    await expect(service.findOne(NOTIFICATION_ID, 'crm')).rejects.toThrow(NotFoundException);
  });

  it('lista só o que o serviço pediu, com página e total', async () => {
    const { service } = buildHarness();

    const page = await service.list('billing', { page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.page).toBe(1);
  });

  it('grava o callbackUrl quando o pedido traz um', async () => {
    const { service, created } = buildHarness();

    await service.create({ ...dto, callbackUrl: 'https://billing.exemplo/hooks' }, 'billing');

    expect(created[0]).toMatchObject({ callbackUrl: 'https://billing.exemplo/hooks' });
  });

  it('reprocessa FAILED e publica de novo', async () => {
    const { service, published } = buildHarness({ status: NotificationStatus.FAILED });

    const notification = await service.redrive(NOTIFICATION_ID, 'billing');

    expect(notification.status).toBe(NotificationStatus.PENDING);
    expect(notification.deliveryCycle).toBe(1);
    expect(published).toEqual([{ id: NOTIFICATION_ID, channel: NotificationChannel.EMAIL }]);
  });

  it('devolve 503 e restaura FAILED quando o redrive não publica', async () => {
    const { service, updates } = buildHarness({
      status: NotificationStatus.FAILED,
      publishFails: true,
    });

    await expect(service.redrive(NOTIFICATION_ID, 'billing')).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(updates.at(-1)).toMatchObject({
      status: NotificationStatus.FAILED,
      deliveryCycle: 0,
    });
  });

  it('recusa redrive de notificação que não falhou', async () => {
    const { service } = buildHarness();

    await expect(service.redrive(NOTIFICATION_ID, 'billing')).rejects.toThrow(ConflictException);
  });

  it('drena a DLQ: reprocessa as FAILED do dono e devolve as dos outros', async () => {
    const { service, published, returnedDead } = buildHarness({
      status: NotificationStatus.FAILED,
      dead: [
        { notificationId: NOTIFICATION_ID, channel: NotificationChannel.EMAIL },
        {
          notificationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          channel: NotificationChannel.SMS,
        },
      ],
    });

    const result = await service.redriveDead('billing', 50);

    expect(result.redriven).toEqual([NOTIFICATION_ID]);
    expect(result.discarded).toBe(0);
    expect(result.returned).toBe(1);
    expect(published).toHaveLength(1);
    expect(returnedDead).toEqual([
      { notificationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', channel: NotificationChannel.SMS },
    ]);
  });
});
