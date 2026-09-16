import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from '../config/env.validation.js';
import { DatabaseModule } from '../database/database.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { MetricsHttpServer } from '../metrics/services/metrics.http-server.js';
import { MetricsModule } from '../metrics/metrics.module.js';
import { NotificationsCoreModule } from '../notifications/notifications-core.module.js';
import { NotificationConsumer } from './consumers/notification.consumer.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    MessagingModule,
    MetricsModule,
    NotificationsCoreModule,
  ],
  providers: [NotificationConsumer, MetricsHttpServer],
})
export class WorkerModule {}
