import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DeliveryModule } from '../delivery/delivery.module.js';
import { TemplatesModule } from '../templates/templates.module.js';
import { IdempotencyService } from './services/idempotency.service.js';
import { NotificationsCoreModule } from './notifications-core.module.js';
import { NotificationsController } from './controllers/notifications.controller.js';
import { NotificationsService } from './services/notifications.service.js';
import { RateLimitService } from './services/rate-limit.service.js';
import { RateLimitedExceptionFilter } from './exceptions/rate-limited.exception-filter.js';

@Module({
  imports: [NotificationsCoreModule, TemplatesModule, DeliveryModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    IdempotencyService,
    RateLimitService,
    { provide: APP_FILTER, useClass: RateLimitedExceptionFilter },
  ],
  exports: [NotificationsCoreModule],
})
export class NotificationsModule {}
