import { createHmac } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;

export type WebhookStatus = NotificationStatus.SENT | NotificationStatus.FAILED;

export interface WebhookDispatchInput {
  id: string;
  channel: NotificationChannel;
  eventType: string;
  recipient: string;
  requestedBy: string;
  callbackUrl: string | null;
  status: WebhookStatus;
  providerMessageId: string | null;
  failureReason: string | null;
}

export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

@Injectable()
export class WebhookDispatcher {
  private readonly logger = new Logger(WebhookDispatcher.name);

  constructor(
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
  ) {}

  async dispatch(input: WebhookDispatchInput): Promise<void> {
    const url = input.callbackUrl?.trim();

    if (!url) {
      return;
    }

    const body = JSON.stringify({
      id: input.id,
      channel: input.channel,
      eventType: input.eventType,
      recipient: input.recipient,
      status: input.status,
      requestedBy: input.requestedBy,
      providerMessageId: input.providerMessageId,
      failureReason: input.failureReason,
      occurredAt: new Date().toISOString(),
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (attempt > 1) {
        await sleep(retryDelayMs(attempt));
      }

      const outcome = await this.post(url, body);

      if (outcome === 'delivered') {
        this.metrics.recordWebhookDelivered(input.channel);
        return;
      }

      if (outcome === 'gone') {
        this.logger.warn(`Webhook ${url} devolveu 410; não retenta ${input.id}`);
        this.metrics.recordWebhookFailed(input.channel);
        return;
      }
    }

    this.logger.warn(`Webhook ${url} falhou depois de ${MAX_ATTEMPTS} tentativas (${input.id})`);
    this.metrics.recordWebhookFailed(input.channel);
  }

  private async post(url: string, body: string): Promise<'delivered' | 'gone' | 'retry'> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = this.config.get<string>('WEBHOOK_SECRET');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'notification-gateway/0.1',
      'X-Webhook-Timestamp': timestamp,
    };

    if (secret) {
      headers['X-Webhook-Signature'] = `sha256=${signWebhookBody(secret, timestamp, body)}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (response.status === 410) {
        return 'gone';
      }

      if (response.ok) {
        return 'delivered';
      }

      this.logger.warn(`Webhook ${url} respondeu HTTP ${response.status}`);
      return 'retry';
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.warn(`Webhook ${url} não respondeu: ${reason}`);
      return 'retry';
    }
  }
}

function retryDelayMs(attempt: number): number {
  if (process.env.NODE_ENV === 'test') {
    return 0;
  }

  return attempt === 2 ? 250 : 1_000;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
