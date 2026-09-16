import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { DeliveryAttemptStatus } from '../../common/enums/delivery-attempt-status.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { DeliveryService } from '../../delivery/services/delivery.service.js';
import { retryDelayAfter } from '../../messaging/policies/retry.policy.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';
import { WebhookDispatcher } from '../../webhooks/services/webhook.dispatcher.js';
import { DeliveryAttempt } from '../entities/delivery-attempt.entity.js';
import type { DeliveryProcessResult } from './delivery-process.result.js';
import { Notification } from '../entities/notification.entity.js';

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly dataSource: DataSource,
    private readonly delivery: DeliveryService,
    private readonly metrics: MetricsService,
    private readonly webhooks: WebhookDispatcher,
  ) {}

  async process(notificationId: string): Promise<DeliveryProcessResult> {
    const notification = await this.notifications.findOne({ where: { id: notificationId } });

    if (!notification) {
      this.logger.warn(`Notificação ${notificationId} não existe; descartando mensagem.`);
      return { kind: 'ignored' };
    }

    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.FAILED
    ) {
      return { kind: 'ignored' };
    }

    const claimed = await this.notifications.update(
      { id: notification.id, status: notification.status },
      { status: NotificationStatus.PROCESSING },
    );

    if (claimed.affected === 0) {
      return { kind: 'ignored' };
    }

    return this.deliver(notification);
  }

  private async deliver(notification: Notification): Promise<DeliveryProcessResult> {
    const startedAt = Date.now();

    try {
      const { providerMessageId } = await this.delivery.send(notification.channel, {
        recipient: notification.recipient,
        subject: notification.subject,
        body: notification.body,
      });

      await this.recordAttempt(notification, {
        durationMs: Date.now() - startedAt,
        attemptStatus: DeliveryAttemptStatus.SUCCESS,
        providerMessageId,
      });

      this.metrics.recordSent(notification.channel, notification.createdAt, Date.now() - startedAt);
      await this.dispatchWebhook(notification, NotificationStatus.SENT, providerMessageId, null);

      return { kind: 'sent' };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Falha desconhecida na entrega';
      this.logger.warn(`Notificação ${notification.id} falhou: ${reason}`);

      const result = await this.recordAttempt(notification, {
        durationMs: Date.now() - startedAt,
        attemptStatus: DeliveryAttemptStatus.FAILURE,
        error: reason,
      });

      if (result.kind === 'retry') {
        this.metrics.recordRetry(notification.channel, Date.now() - startedAt);
      }

      if (result.kind === 'dead') {
        this.metrics.recordFailed(notification.channel, Date.now() - startedAt);
        await this.dispatchWebhook(notification, NotificationStatus.FAILED, null, reason);
      }

      return result;
    }
  }

  private async recordAttempt(
    notification: Notification,
    outcome: {
      durationMs: number;
      attemptStatus: DeliveryAttemptStatus;
      providerMessageId?: string;
      error?: string;
    },
  ): Promise<DeliveryProcessResult> {
    const succeeded = outcome.attemptStatus === DeliveryAttemptStatus.SUCCESS;

    return this.dataSource.transaction(async (manager) => {
      const attempts = manager.getRepository(DeliveryAttempt);
      const notifications = manager.getRepository(Notification);
      const cycle = notification.deliveryCycle ?? 0;
      const previousAttempts = await attempts.countBy({
        notificationId: notification.id,
        cycle,
      });
      const attemptNumber = previousAttempts + 1;

      await attempts.save(
        attempts.create({
          notificationId: notification.id,
          attemptNumber,
          cycle,
          status: outcome.attemptStatus,
          providerMessageId: outcome.providerMessageId ?? null,
          error: outcome.error ?? null,
          durationMs: outcome.durationMs,
        }),
      );

      if (succeeded) {
        await notifications.update(notification.id, {
          status: NotificationStatus.SENT,
          sentAt: new Date(),
          failureReason: null,
        });

        return { kind: 'sent' };
      }

      const delayMs = retryDelayAfter(attemptNumber);

      if (delayMs === null) {
        await notifications.update(notification.id, {
          status: NotificationStatus.FAILED,
          sentAt: null,
          failureReason: outcome.error ?? null,
        });

        return { kind: 'dead', channel: notification.channel };
      }

      await notifications.update(notification.id, {
        failureReason: outcome.error ?? null,
      });

      this.logger.warn(
        `Notificação ${notification.id}: tentativa ${attemptNumber} falhou; retry em ${delayMs}ms`,
      );

      return { kind: 'retry', delayMs, channel: notification.channel };
    });
  }

  private async dispatchWebhook(
    notification: Notification,
    status: NotificationStatus.SENT | NotificationStatus.FAILED,
    providerMessageId: string | null,
    failureReason: string | null,
  ): Promise<void> {
    await this.webhooks.dispatch({
      id: notification.id,
      channel: notification.channel,
      eventType: notification.eventType,
      recipient: notification.recipient,
      requestedBy: notification.requestedBy,
      callbackUrl: notification.callbackUrl,
      status,
      providerMessageId,
      failureReason,
    });
  }
}
