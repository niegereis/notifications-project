import { Injectable } from '@nestjs/common';

import type { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { AmqpService } from '../services/amqp.service.js';

@Injectable()
export class NotificationPublisher {
  constructor(private readonly amqp: AmqpService) {}

  publish(notification: { id: string; channel: NotificationChannel }): Promise<void> {
    return this.amqp.publish({
      notificationId: notification.id,
      channel: notification.channel,
    });
  }
}
