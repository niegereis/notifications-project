import type { HealthIndicatorService } from '@nestjs/terminus';

import { RedisService } from '../../redis/services/redis.service.js';
import { RedisHealthIndicator } from './redis-health.indicator.js';

function indicatorWith(redis: Partial<RedisService>): RedisHealthIndicator {
  const health = {
    check: (key: string) => ({
      up: () => ({ [key]: { status: 'up' } }),
      down: (info: Record<string, unknown>) => ({ [key]: { status: 'down', ...info } }),
    }),
  } as unknown as HealthIndicatorService;

  return new RedisHealthIndicator(health, redis as RedisService);
}

describe('RedisHealthIndicator', () => {
  it('reporta up quando o ping responde', async () => {
    const indicator = indicatorWith({
      isReady: () => true,
      ping: () => Promise.resolve('PONG'),
    });

    await expect(indicator.isHealthy()).resolves.toEqual({ redis: { status: 'up' } });
  });

  it('reporta down quando não há conexão', async () => {
    const indicator = indicatorWith({
      isReady: () => false,
      ping: () => Promise.resolve('PONG'),
    });

    await expect(indicator.isHealthy()).resolves.toMatchObject({
      redis: { status: 'down', message: 'Sem conexão com o Redis' },
    });
  });

  it('reporta down quando o ping falha', async () => {
    const indicator = indicatorWith({
      isReady: () => true,
      ping: () => Promise.reject(new Error('conexão recusada')),
    });

    await expect(indicator.isHealthy()).resolves.toMatchObject({
      redis: { status: 'down', message: 'conexão recusada' },
    });
  });
});
