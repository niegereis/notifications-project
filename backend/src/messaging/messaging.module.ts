import { Global, Module } from '@nestjs/common';

import { AmqpService } from './services/amqp.service.js';
import { NotificationPublisher } from './publishers/notification.publisher.js';

@Global()
@Module({
  providers: [AmqpService, NotificationPublisher],
  exports: [AmqpService, NotificationPublisher],
})
export class MessagingModule {}
