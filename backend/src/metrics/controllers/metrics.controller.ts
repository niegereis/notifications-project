import { Controller, Get, Header } from '@nestjs/common';

import { Public } from '../../auth/decorators/public.decorator.js';
import { MetricsService } from '../services/metrics.service.js';

@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
