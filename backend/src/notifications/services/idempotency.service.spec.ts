import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../redis/services/redis.service.js';
import { IdempotencyService } from './idempotency.service.js';

function buildService(store: Map<string, string>): IdempotencyService {
  const redis = {
    setNx: (key: string, value: string) => {
      if (store.has(key)) {
        return Promise.resolve(false);
      }

      store.set(key, value);
      return Promise.resolve(true);
    },
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (key: string) => {
      store.delete(key);
      return Promise.resolve(1);
    },
  } as unknown as RedisService;

  const config = {
    get: () => 86_400,
  } as unknown as ConfigService;

  return new IdempotencyService(redis, config);
}

describe('IdempotencyService', () => {
  it('reserva a chave na primeira vez', async () => {
    const service = buildService(new Map());

    await expect(service.reserve('billing', 'k1', 'fp-a')).resolves.toEqual({ kind: 'acquired' });
  });

  it('devolve o mesmo id na segunda vez com o mesmo fingerprint', async () => {
    const store = new Map<string, string>();
    const service = buildService(store);

    await service.reserve('billing', 'k1', 'fp-a');
    await service.commit('billing', 'k1', 'notif-1');

    await expect(service.reserve('billing', 'k1', 'fp-a')).resolves.toEqual({
      kind: 'replay',
      notificationId: 'notif-1',
    });
  });

  it('recusa a mesma chave com corpo diferente', async () => {
    const store = new Map<string, string>();
    const service = buildService(store);

    await service.reserve('billing', 'k1', 'fp-a');
    await service.commit('billing', 'k1', 'notif-1');

    await expect(service.reserve('billing', 'k1', 'fp-b')).rejects.toThrow(ConflictException);
  });

  it('recusa a chave enquanto o primeiro pedido ainda não gravou o id', async () => {
    const service = buildService(new Map());

    await service.reserve('billing', 'k1', 'fp-a');

    await expect(service.reserve('billing', 'k1', 'fp-a')).rejects.toThrow(ConflictException);
  });
});
