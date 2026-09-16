import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DeliveryModule } from '../delivery/delivery.module.js';
import { WebhooksModule } from '../webhooks/webhooks.module.js';
import { DeliveryAttempt } from './entities/delivery-attempt.entity.js';
import { Notification } from './entities/notification.entity.js';
import { NotificationProcessor } from './processors/notification.processor.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, DeliveryAttempt]),
    DeliveryModule,
    WebhooksModule,
  ],
  providers: [NotificationProcessor],
  exports: [TypeOrmModule, NotificationProcessor],
})
export class NotificationsCoreModule {}
