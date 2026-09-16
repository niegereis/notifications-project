import { generateKeyPairSync } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { PushProvider } from './push.provider.js';
import { SmsProvider } from './sms.provider.js';

const smsRequest = {
  recipient: '+5511999999999',
  subject: null,
  body: 'Seu pedido saiu.',
};

const pushRequest = {
  recipient: 'a'.repeat(16),
  subject: 'Pedido',
  body: 'Seu pedido saiu.',
};

function configStub(values: Record<string, string | undefined> = {}): ConfigService {
  return { get: (key: string) => values[key] } as ConfigService;
}

describe('provedores de entrega', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SMS sem Twilio simula o envio', async () => {
    const provider = new SmsProvider(configStub());
    const result = await provider.send(smsRequest);

    expect(provider.channel).toBe(NotificationChannel.SMS);
    expect(result.providerMessageId).toMatch(/^sms-sim-/);
  });

  it('push sem FCM simula o envio', async () => {
    const provider = new PushProvider(configStub());
    const result = await provider.send(pushRequest);

    expect(provider.channel).toBe(NotificationChannel.PUSH);
    expect(result.providerMessageId).toMatch(/^push-sim-/);
  });

  it('SMS com Twilio envia para a API e devolve o sid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ sid: 'SM123' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new SmsProvider(
      configStub({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM: '+5511999000000',
      }),
    );

    await expect(provider.send(smsRequest)).resolves.toEqual({ providerMessageId: 'SM123' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('SMS com Twilio propaga recusa do provedor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'The number is invalid' }),
      }),
    );

    const provider = new SmsProvider(
      configStub({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM: '+5511999000000',
      }),
    );

    await expect(provider.send(smsRequest)).rejects.toThrow(/invalid/);
  });

  it('SMS com Twilio recusa resposta sem sid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );

    const provider = new SmsProvider(
      configStub({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM: '+5511999000000',
      }),
    );

    await expect(provider.send(smsRequest)).rejects.toThrow(/sid/);
  });

  it('SMS com Twilio envolve erro de rede', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));

    const provider = new SmsProvider(
      configStub({
        TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        TWILIO_AUTH_TOKEN: 'token',
        TWILIO_FROM: '+5511999000000',
      }),
    );

    await expect(provider.send(smsRequest)).rejects.toThrow(/fetch failed/);
  });

  it('push com FCM pede token e envia a mensagem', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'ya29.token', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ name: 'projects/demo/messages/m-1' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PushProvider(
      configStub({
        FCM_PROJECT_ID: 'demo',
        FCM_CLIENT_EMAIL: 'fcm@demo.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: pem,
      }),
    );

    await expect(provider.send(pushRequest)).resolves.toEqual({
      providerMessageId: 'projects/demo/messages/m-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('push reusa o access token em envio seguinte', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'ya29.token', expires_in: 3600 }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'projects/demo/messages/m-2' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new PushProvider(
      configStub({
        FCM_PROJECT_ID: 'demo',
        FCM_CLIENT_EMAIL: 'fcm@demo.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: pem.replaceAll('\n', '\\n'),
      }),
    );

    await provider.send(pushRequest);
    await provider.send(pushRequest);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('push propaga recusa do FCM', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'ya29.token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: 'Invalid registration token' } }),
        }),
    );

    const provider = new PushProvider(
      configStub({
        FCM_PROJECT_ID: 'demo',
        FCM_CLIENT_EMAIL: 'fcm@demo.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: pem,
      }),
    );

    await expect(provider.send(pushRequest)).rejects.toThrow(/Invalid registration token/);
  });

  it('push propaga recusa do OAuth do Google', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error_description: 'invalid_grant' }),
      }),
    );

    const provider = new PushProvider(
      configStub({
        FCM_PROJECT_ID: 'demo',
        FCM_CLIENT_EMAIL: 'fcm@demo.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: pem,
      }),
    );

    await expect(provider.send(pushRequest)).rejects.toThrow(/invalid_grant/);
  });
});
