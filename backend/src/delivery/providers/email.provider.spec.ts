import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailProvider } from './email.provider.js';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

function configStub(values: Record<string, unknown> = {}): ConfigService {
  const all: Record<string, unknown> = {
    SMTP_HOST: 'mailpit',
    SMTP_PORT: 1025,
    MAIL_FROM: 'no-reply@example.com',
    ...values,
  };

  return {
    get: (key: string) => all[key],
    getOrThrow: (key: string) => all[key],
  } as ConfigService;
}

describe('EmailProvider', () => {
  const sendMail = vi.fn();

  beforeEach(() => {
    sendMail.mockReset();
    vi.mocked(createTransport).mockReset();
    vi.mocked(createTransport).mockReturnValue({ sendMail } as never);
  });

  it('usa pool SMTP com 5 conexões por padrão', () => {
    new EmailProvider(configStub());

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailpit',
        port: 1025,
        pool: true,
        maxConnections: 5,
      }),
    );
  });

  it('acompanha CONSUMER_PREFETCH quando ele passa de 5', () => {
    new EmailProvider(configStub({ CONSUMER_PREFETCH: 20 }));

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ maxConnections: 20 }));
  });

  it('ignora variáveis vazias vindas do compose', () => {
    new EmailProvider(configStub({ SMTP_POOL_MAX_CONNECTIONS: '', CONSUMER_PREFETCH: '' }));

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ maxConnections: 5 }));
  });

  it('respeita SMTP_POOL_MAX_CONNECTIONS', () => {
    new EmailProvider(configStub({ SMTP_POOL_MAX_CONNECTIONS: 12 }));

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ maxConnections: 12 }));
  });

  it('devolve o messageId do provedor', async () => {
    sendMail.mockResolvedValue({ messageId: '<abc@mailpit>' });
    const provider = new EmailProvider(configStub());

    const result = await provider.send({ recipient: 'a@b.co', subject: 'Oi', body: 'Texto' });

    expect(result).toEqual({ providerMessageId: '<abc@mailpit>' });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.co', subject: 'Oi', text: 'Texto' }),
    );
  });

  it('converte falha do SMTP em DeliveryError', async () => {
    sendMail.mockRejectedValue(new Error('conexão recusada'));
    const provider = new EmailProvider(configStub());

    await expect(
      provider.send({ recipient: 'a@b.co', subject: null, body: 'Texto' }),
    ).rejects.toThrow(/recusou o envio: conexão recusada/);
  });
});
