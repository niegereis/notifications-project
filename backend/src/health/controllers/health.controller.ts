import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../../auth/decorators/public.decorator.js';
import { AppHealthIndicator } from '../indicators/app-health.indicator.js';
import { RabbitHealthIndicator } from '../indicators/rabbit-health.indicator.js';
import { RedisHealthIndicator } from '../indicators/redis-health.indicator.js';

const HEAP_LIMIT_BYTES = 512 * 1024 * 1024;

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly app: AppHealthIndicator,
    private readonly database: TypeOrmHealthIndicator,
    private readonly rabbit: RabbitHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  live() {
    return this.health.check([() => this.app.isAlive()]);
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', HEAP_LIMIT_BYTES),
      () => this.database.pingCheck('database'),
      () => this.rabbit.isHealthy(),
      () => this.redis.isHealthy(),
    ]);
  }
}
