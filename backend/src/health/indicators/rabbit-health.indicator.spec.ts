import type { HealthIndicatorService } from '@nestjs/terminus';

import { AmqpService } from '../../messaging/services/amqp.service.js';
import { RabbitHealthIndicator } from './rabbit-health.indicator.js';

function indicatorWith(connected: boolean): RabbitHealthIndicator {
  const health = {
    check: (key: string) => ({
      up: () => ({ [key]: { status: 'up' } }),
      down: (info: Record<string, unknown>) => ({ [key]: { status: 'down', ...info } }),
    }),
  } as unknown as HealthIndicatorService;

  const amqp = { isConnected: () => connected } as unknown as AmqpService;

  return new RabbitHealthIndicator(health, amqp);
}

describe('RabbitHealthIndicator', () => {
  it('reporta up quando o broker está conectado', () => {
    expect(indicatorWith(true).isHealthy()).toEqual({ rabbitmq: { status: 'up' } });
  });

  it('reporta down quando o broker caiu', () => {
    expect(indicatorWith(false).isHealthy()).toMatchObject({
      rabbitmq: { status: 'down', message: 'Sem conexão com o RabbitMQ' },
    });
  });
});
