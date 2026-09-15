import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { AppHealthIndicator } from './indicators/app-health.indicator.js';
import { HealthController } from './controllers/health.controller.js';
import { RabbitHealthIndicator } from './indicators/rabbit-health.indicator.js';
import { RedisHealthIndicator } from './indicators/redis-health.indicator.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [AppHealthIndicator, RabbitHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
