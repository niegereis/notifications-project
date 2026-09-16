import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { AmqpService } from '../../messaging/services/amqp.service.js';
import { CONSUMED_CHANNELS, queueFor } from '../../messaging/topology/amqp.topology.js';
import { parseNotificationMessage } from '../../messaging/messages/notification.message.js';
import { NotificationProcessor } from '../../notifications/processors/notification.processor.js';

@Injectable()
export class NotificationConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationConsumer.name);

  constructor(
    private readonly amqp: AmqpService,
    private readonly processor: NotificationProcessor,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const channel of CONSUMED_CHANNELS) {
      const queue = queueFor(channel);
      await this.amqp.consume(queue, async (message) => {
        await this.handle(message.content);
      });
      this.logger.log(`Consumindo ${queue}`);
    }
  }

  async handle(content: Buffer): Promise<void> {
    const payload = parseNotificationMessage(content);

    if (!payload) {
      this.logger.warn('Mensagem inválida descartada');
      return;
    }

    const result = await this.processor.process(payload.notificationId);

    if (result.kind === 'retry') {
      await this.amqp.publishRetry(payload, result.delayMs);
      return;
    }

    if (result.kind === 'dead') {
      await this.amqp.publishDead(payload);
    }
  }
}
