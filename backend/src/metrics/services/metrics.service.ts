import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();

  private readonly accepted: Counter;
  private readonly replays: Counter;
  private readonly enqueueFailed: Counter;
  private readonly sent: Counter;
  private readonly failed: Counter;
  private readonly retries: Counter;
  private readonly redriven: Counter;
  private readonly webhookDelivered: Counter;
  private readonly webhookFailed: Counter;
  private readonly deliveryDuration: Histogram;
  private readonly attemptDuration: Histogram;

  constructor() {
    // Intervalo do collectDefaultMetrics impede o Vitest de encerrar.
    if (process.env.NODE_ENV !== 'test') {
      collectDefaultMetrics({ register: this.registry });
    }

    this.accepted = new Counter({
      name: 'notifications_accepted_total',
      help: 'Pedidos aceitos (HTTP 202) por canal.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.replays = new Counter({
      name: 'notifications_replayed_total',
      help: 'Replays de Idempotency-Key que não criaram pedido novo.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.enqueueFailed = new Counter({
      name: 'notifications_enqueue_failed_total',
      help: 'Falhas ao publicar na exchange (API devolveu 503).',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.sent = new Counter({
      name: 'notifications_sent_total',
      help: 'Entregas bem-sucedidas por canal.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.failed = new Counter({
      name: 'notifications_failed_total',
      help: 'Notificações que esgotaram retry e foram para a dead-letter.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.retries = new Counter({
      name: 'notifications_retries_total',
      help: 'Tentativas que voltaram para a fila de espera.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.redriven = new Counter({
      name: 'notifications_redriven_total',
      help: 'Notificações FAILED recolocadas na fila de trabalho.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.webhookDelivered = new Counter({
      name: 'notification_webhooks_delivered_total',
      help: 'Callbacks de desfecho entregues com HTTP 2xx.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.webhookFailed = new Counter({
      name: 'notification_webhooks_failed_total',
      help: 'Callbacks de desfecho que esgotaram retry ou devolveram 410.',
      labelNames: ['channel'],
      registers: [this.registry],
    });
    this.deliveryDuration = new Histogram({
      name: 'notification_delivery_duration_seconds',
      help: 'Tempo entre a criação do pedido (publicação) e a entrega.',
      labelNames: ['channel'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.attemptDuration = new Histogram({
      name: 'notification_attempt_duration_seconds',
      help: 'Duração da chamada ao provedor, por resultado.',
      labelNames: ['channel', 'result'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
      registers: [this.registry],
    });

    for (const channel of Object.values(NotificationChannel)) {
      this.accepted.inc({ channel }, 0);
      this.replays.inc({ channel }, 0);
      this.enqueueFailed.inc({ channel }, 0);
      this.sent.inc({ channel }, 0);
      this.failed.inc({ channel }, 0);
      this.retries.inc({ channel }, 0);
      this.redriven.inc({ channel }, 0);
      this.webhookDelivered.inc({ channel }, 0);
      this.webhookFailed.inc({ channel }, 0);
    }
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  recordAccepted(channel: NotificationChannel): void {
    this.accepted.inc({ channel });
  }

  recordReplay(channel: NotificationChannel): void {
    this.replays.inc({ channel });
  }

  recordEnqueueFailed(channel: NotificationChannel): void {
    this.enqueueFailed.inc({ channel });
  }

  recordSent(channel: NotificationChannel, createdAt: Date, attemptDurationMs: number): void {
    this.sent.inc({ channel });
    this.attemptDuration.observe({ channel, result: 'success' }, attemptDurationMs / 1000);
    this.deliveryDuration.observe(
      { channel },
      Math.max(0, (Date.now() - createdAt.getTime()) / 1000),
    );
  }

  recordRetry(channel: NotificationChannel, attemptDurationMs: number): void {
    this.retries.inc({ channel });
    this.attemptDuration.observe({ channel, result: 'retry' }, attemptDurationMs / 1000);
  }

  recordFailed(channel: NotificationChannel, attemptDurationMs: number): void {
    this.failed.inc({ channel });
    this.attemptDuration.observe({ channel, result: 'failure' }, attemptDurationMs / 1000);
  }

  recordRedriven(channel: NotificationChannel): void {
    this.redriven.inc({ channel });
  }

  recordWebhookDelivered(channel: NotificationChannel): void {
    this.webhookDelivered.inc({ channel });
  }

  recordWebhookFailed(channel: NotificationChannel): void {
    this.webhookFailed.inc({ channel });
  }
}
