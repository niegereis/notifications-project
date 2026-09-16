import { ConfigService } from '@nestjs/config';

import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { RedisService } from '../../redis/services/redis.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { RateLimitedException } from '../exceptions/rate-limited.exception.js';

function buildService(max: number, counts: Map<string, number>): RateLimitService {
  const redis = {
    incr: (key: string) => {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return Promise.resolve(next);
    },
    expire: () => Promise.resolve(true),
    ttl: () => Promise.resolve(30),
  } as unknown as RedisService;

  const config = {
    get: (name: string) => (name === 'RATE_LIMIT_MAX' ? max : 60),
  } as unknown as ConfigService;

  return new RateLimitService(redis, config);
}

describe('RateLimitService', () => {
  it('deixa passar até o teto e recusa o próximo', async () => {
    const service = buildService(2, new Map());

    await service.consume(NotificationChannel.EMAIL, 'ana@exemplo.com');
    await service.consume(NotificationChannel.EMAIL, 'ana@exemplo.com');

    await expect(service.consume(NotificationChannel.EMAIL, 'ana@exemplo.com')).rejects.toThrow(
      RateLimitedException,
    );
  });

  it('conta cada destinatário separado', async () => {
    const service = buildService(1, new Map());

    await service.consume(NotificationChannel.EMAIL, 'ana@exemplo.com');
    await expect(
      service.consume(NotificationChannel.EMAIL, 'bruno@exemplo.com'),
    ).resolves.toBeUndefined();
  });
});
