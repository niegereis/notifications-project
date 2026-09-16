import type { DataSource, EntityManager, Repository } from 'typeorm';

import { DeliveryAttemptStatus } from '../../common/enums/delivery-attempt-status.enum.js';
import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { DeliveryService } from '../../delivery/services/delivery.service.js';
import { DeliveryError } from '../../delivery/types/delivery.types.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';
import { WebhookDispatcher } from '../../webhooks/services/webhook.dispatcher.js';
import { DeliveryAttempt } from '../entities/delivery-attempt.entity.js';
import { Notification } from '../entities/notification.entity.js';
import { NotificationProcessor } from './notification.processor.js';

const NOTIFICATION_ID = '1e6f5d6a-0d3d-4f1a-9c62-2a3a7b1f9c11';

interface Harness {
  processor: NotificationProcessor;
  attempts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  sent: number;
  webhooks: Array<{ status: string; providerMessageId: string | null }>;
}

function buildHarness(
  options: {
    status?: NotificationStatus;
    sendFails?: boolean;
    missing?: boolean;
    previousAttempts?: number;
  } = {},
): Harness {
  const attempts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const webhooks: Array<{ status: string; providerMessageId: string | null }> = [];
  let sent = 0;

  const persisted = {
    id: NOTIFICATION_ID,
    channel: NotificationChannel.EMAIL,
    recipient: 'ana@exemplo.com',
    subject: 'Bem-vindo(a), Ana!',
    body: 'Olá Ana',
    eventType: 'user.welcome',
    requestedBy: 'billing',
    callbackUrl: 'http://localhost:9999/hook',
    deliveryCycle: 0,
    status: options.status ?? NotificationStatus.PENDING,
    createdAt: new Date(Date.now() - 200),
  };

  const notifications = {
    findOne: () => Promise.resolve(options.missing ? null : persisted),
    update: (_criteria: unknown, data: Record<string, unknown>) => {
      updates.push(data);
      return Promise.resolve({ affected: 1 });
    },
  } as unknown as Repository<Notification>;

  const deliveryAttempts = {
    create: (data: Record<string, unknown>) => data,
    save: (data: Record<string, unknown>) => {
      attempts.push(data);
      return Promise.resolve(data);
    },
    countBy: () => Promise.resolve(options.previousAttempts ?? 0),
  } as unknown as Repository<DeliveryAttempt>;

  const manager = {
    getRepository: (entity: unknown) =>
      entity === Notification ? notifications : deliveryAttempts,
  } as unknown as EntityManager;

  const dataSource = {
    transaction: (run: (manager: EntityManager) => Promise<unknown>) => run(manager),
  } as unknown as DataSource;

  const delivery = {
    send: () => {
      sent += 1;

      return options.sendFails
        ? Promise.reject(new DeliveryError('Provedor de e-mail recusou o envio: conexão recusada'))
        : Promise.resolve({ providerMessageId: 'msg-1' });
    },
  } as unknown as DeliveryService;

  const metrics = {
    recordSent: () => undefined,
    recordRetry: () => undefined,
    recordFailed: () => undefined,
  } as unknown as MetricsService;

  const dispatcher = {
    dispatch: (input: { status: string; providerMessageId: string | null }) => {
      webhooks.push({ status: input.status, providerMessageId: input.providerMessageId });
      return Promise.resolve();
    },
  } as unknown as WebhookDispatcher;

  return {
    processor: new NotificationProcessor(notifications, dataSource, delivery, metrics, dispatcher),
    attempts,
    updates,
    webhooks,
    get sent() {
      return sent;
    },
  };
}

describe('NotificationProcessor', () => {
  it('marca como enviada e guarda a tentativa bem-sucedida', async () => {
    const { processor, attempts, updates, webhooks } = buildHarness();

    await expect(processor.process(NOTIFICATION_ID)).resolves.toEqual({ kind: 'sent' });

    expect(updates[0]).toMatchObject({ status: NotificationStatus.PROCESSING });
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: DeliveryAttemptStatus.SUCCESS,
      providerMessageId: 'msg-1',
    });
    expect(updates[1]).toMatchObject({ status: NotificationStatus.SENT });
    expect(webhooks).toEqual([{ status: NotificationStatus.SENT, providerMessageId: 'msg-1' }]);
  });

  it('agenda retry e permanece em processing na primeira falha', async () => {
    const { processor, attempts, updates, webhooks } = buildHarness({ sendFails: true });

    await expect(processor.process(NOTIFICATION_ID)).resolves.toEqual({
      kind: 'retry',
      delayMs: 1_000,
      channel: NotificationChannel.EMAIL,
    });

    expect(attempts[0]).toMatchObject({ status: DeliveryAttemptStatus.FAILURE });
    expect(String(attempts[0]?.error)).toContain('conexão recusada');
    expect(String(updates[1]?.failureReason)).toContain('conexão recusada');
    expect(updates[1]).not.toHaveProperty('status', NotificationStatus.FAILED);
    expect(webhooks).toEqual([]);
  });

  it('marca como falha definitiva depois da última tentativa', async () => {
    const { processor, updates, webhooks } = buildHarness({ sendFails: true, previousAttempts: 2 });

    await expect(processor.process(NOTIFICATION_ID)).resolves.toEqual({
      kind: 'dead',
      channel: NotificationChannel.EMAIL,
    });

    expect(updates[1]).toMatchObject({
      status: NotificationStatus.FAILED,
      sentAt: null,
    });
    expect(webhooks).toEqual([{ status: NotificationStatus.FAILED, providerMessageId: null }]);
  });

  it('não reenvia notificação já entregue', async () => {
    const harness = buildHarness({ status: NotificationStatus.SENT });

    await expect(harness.processor.process(NOTIFICATION_ID)).resolves.toEqual({ kind: 'ignored' });
    expect(harness.sent).toBe(0);
    expect(harness.attempts).toEqual([]);
  });

  it('ignora mensagem de notificação que não existe', async () => {
    const harness = buildHarness({ missing: true });

    await expect(harness.processor.process(NOTIFICATION_ID)).resolves.toEqual({ kind: 'ignored' });
    expect(harness.sent).toBe(0);
  });
});
