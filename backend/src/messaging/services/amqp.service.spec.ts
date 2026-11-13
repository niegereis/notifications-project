import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AmqpService } from './amqp.service.js';

vi.mock('amqplib', () => ({ connect: vi.fn() }));

function configStub(values: Record<string, unknown> = {}): ConfigService {
  const all: Record<string, unknown> = { RABBITMQ_URL: 'amqp://localhost', ...values };

  return {
    get: (key: string) => all[key],
    getOrThrow: (key: string) => all[key],
  } as ConfigService;
}

function fakeChannel() {
  return {
    prefetch: vi.fn().mockResolvedValue(undefined),
    assertExchange: vi.fn().mockResolvedValue(undefined),
    assertQueue: vi.fn().mockResolvedValue(undefined),
    bindQueue: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Sobe o serviço e dispara o `setup` de recuperação como o amqplib faria.
async function connectWith(values: Record<string, unknown>) {
  const channel = fakeChannel();
  const model = { createConfirmChannel: vi.fn().mockResolvedValue(channel) };

  vi.mocked(connect).mockImplementation((async (
    _url: string,
    options: { recovery: { setup: (model: unknown) => Promise<void> } },
  ) => {
    await options.recovery.setup(model);

    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  }) as never);

  const service = new AmqpService(configStub(values));
  await service.onModuleInit();

  return { channel, service };
}

describe('AmqpService', () => {
  beforeEach(() => {
    vi.mocked(connect).mockReset();
  });

  it('usa prefetch 1 quando CONSUMER_PREFETCH não está definido', async () => {
    const { channel, service } = await connectWith({});

    expect(channel.prefetch).toHaveBeenCalledWith(1);
    expect(service.isConnected()).toBe(true);
  });

  it('trata CONSUMER_PREFETCH vazio (como o compose passa) como 1, nunca como sem limite', async () => {
    const { channel } = await connectWith({ CONSUMER_PREFETCH: '' });

    expect(channel.prefetch).toHaveBeenCalledWith(1);
  });

  it('aplica CONSUMER_PREFETCH ao canal', async () => {
    const { channel } = await connectWith({ CONSUMER_PREFETCH: 20 });

    expect(channel.prefetch).toHaveBeenCalledTimes(1);
    expect(channel.prefetch).toHaveBeenCalledWith(20);
  });

  it('processa mensagens em paralelo: não espera o handler anterior para despachar o próximo', async () => {
    const { channel, service } = await connectWith({ CONSUMER_PREFETCH: 5 });
    const releases: Array<() => void> = [];
    const started: number[] = [];

    await service.consume('notifications.email', async (message) => {
      started.push(message.content.length);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    const onMessage = channel.consume.mock.calls[0][1] as (m: unknown) => void;
    const ackable = { ack: vi.fn(), nack: vi.fn() };
    Object.assign(channel, ackable);

    for (const size of [1, 2, 3]) {
      onMessage({ content: Buffer.alloc(size) });
    }
    await Promise.resolve();

    // Os três handlers começaram sem nenhum terminar.
    expect(started).toEqual([1, 2, 3]);
    expect(ackable.ack).not.toHaveBeenCalled();

    releases.forEach((release) => release());
    await new Promise((resolve) => setImmediate(resolve));
    expect(ackable.ack).toHaveBeenCalledTimes(3);
  });
});
