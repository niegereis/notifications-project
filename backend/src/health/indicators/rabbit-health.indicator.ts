import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { AmqpService } from '../../messaging/services/amqp.service.js';

@Injectable()
export class RabbitHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly amqp: AmqpService,
  ) {}

  isHealthy(key = 'rabbitmq'): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.amqp.isConnected()) {
      return indicator.down({ message: 'Sem conexão com o RabbitMQ' });
    }

    return indicator.up();
  }
}
