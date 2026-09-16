import { Global, Module } from '@nestjs/common';

import { MetricsController } from './controllers/metrics.controller.js';
import { MetricsService } from './services/metrics.service.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
