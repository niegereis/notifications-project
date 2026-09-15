import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

@Injectable()
export class AppHealthIndicator {
  constructor(private readonly healthIndicatorService: HealthIndicatorService) {}

  isAlive(key = 'app'): HealthIndicatorResult {
    return this.healthIndicatorService.check(key).up({
      version: process.env.npm_package_version ?? '0.1.0',
      uptimeSeconds: Math.round(process.uptime()),
    });
  }
}
