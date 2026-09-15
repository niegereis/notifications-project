import { Test, TestingModule } from '@nestjs/testing';
import { TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';

import { AppHealthIndicator } from '../indicators/app-health.indicator.js';
import { HealthController } from './health.controller.js';
import { RabbitHealthIndicator } from '../indicators/rabbit-health.indicator.js';
import { RedisHealthIndicator } from '../indicators/redis-health.indicator.js';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule],
      controllers: [HealthController],
      providers: [
        AppHealthIndicator,
        {
          provide: TypeOrmHealthIndicator,
          useValue: {
            pingCheck: () => Promise.resolve({ database: { status: 'up' } }),
          },
        },
        {
          provide: RabbitHealthIndicator,
          useValue: {
            isHealthy: () => ({ rabbitmq: { status: 'up' } }),
          },
        },
        {
          provide: RedisHealthIndicator,
          useValue: {
            isHealthy: () => Promise.resolve({ redis: { status: 'up' } }),
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reporta liveness com status ok', async () => {
    const result = await controller.live();

    expect(result.status).toBe('ok');
    expect(result.info?.app?.status).toBe('up');
  });

  it('reporta readiness com status ok', async () => {
    const result = await controller.ready();

    expect(result.status).toBe('ok');
    expect(result.info?.memory_heap?.status).toBe('up');
  });
});
