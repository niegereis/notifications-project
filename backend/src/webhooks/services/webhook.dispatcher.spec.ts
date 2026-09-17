import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import { MetricsService } from '../../metrics/services/metrics.service.js';
import { signWebhookBody, WebhookDispatcher } from './webhook.dispatcher.js';

function dispatcherWith(secret?: string): WebhookDispatcher {
  const config = {
    get: (key: string) => (key === 'WEBHOOK_SECRET' ? secret : undefined),
  } as unknown as ConfigService;

  return new WebhookDispatcher(config, new MetricsService());
}

const input = {
  id: 'n-1',
  channel: NotificationChannel.EMAIL,
  eventType: 'user.welcome',
  recipient: 'ana@exemplo.com',
  requestedBy: 'billing',
  callbackUrl: 'http://localhost:9999/hooks',
  status: NotificationStatus.SENT as const,
  providerMessageId: 'smtp-1',
  failureReason: null,
};

describe('WebhookDispatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não chama nada quando não há callbackUrl', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith('webhook-secret-16').dispatch({ ...input, callbackUrl: null });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTa o desfecho assinado e para no 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith('webhook-secret-16').dispatch(input);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = typeof init.body === 'string' ? init.body : '';
    const timestamp = headers['X-Webhook-Timestamp'];

    expect(headers['X-Webhook-Signature']).toBe(
      `sha256=${signWebhookBody('webhook-secret-16', timestamp, body)}`,
    );
    expect(JSON.parse(body)).toMatchObject({
      id: 'n-1',
      status: 'SENT',
      providerMessageId: 'smtp-1',
    });
  });

  it('retenta quando a URL falha e registra a falha depois do teto', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith().dispatch(input);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('não retenta depois de HTTP 410', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 410 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith().dispatch(input);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('retenta resposta HTTP que não é 2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith().dispatch(input);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('envia sem assinatura quando não há WEBHOOK_SECRET', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatcherWith().dispatch(input);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Webhook-Signature']).toBeUndefined();
  });
});
