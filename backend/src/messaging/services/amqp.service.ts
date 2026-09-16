import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
  type Options,
  type RecoveringChannelModel,
} from 'amqplib';

import {
  CONSUMED_CHANNELS,
  DEAD_EXCHANGE,
  DEAD_QUEUE,
  NOTIFICATIONS_EXCHANGE,
  RETRY_EXCHANGE,
  RETRY_QUEUE_DELAYS_MS,
  queueFor,
  retryQueueFor,
  retryRoutingKeyFor,
  routingKeyFor,
} from '../topology/amqp.topology.js';
import {
  type NotificationQueuedMessage,
  parseNotificationMessage,
  serializeNotificationMessage,
} from '../messages/notification.message.js';

export type ConsumedMessageHandler = (message: ConsumeMessage) => Promise<void>;

interface RegisteredConsumer {
  queue: string;
  handler: ConsumedMessageHandler;
}

@Injectable()
export class AmqpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AmqpService.name);
  private connection: RecoveringChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connected = false;
  private readonly consumers: RegisteredConsumer[] = [];

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const url = this.configService.getOrThrow<string>('RABBITMQ_URL');

    this.connection = await connect(url, {
      recovery: {
        initialDelay: 200,
        maxDelay: 10_000,
        setup: async (model: ChannelModel) => {
          await this.onConnected(model);
        },
      },
    });

    this.connection.on('disconnect', (error: Error) => {
      this.connected = false;
      this.channel = null;
      this.logger.warn(`RabbitMQ desconectou: ${error.message}`);
    });

    this.connection.on('reconnect-scheduled', (info: { attempt: number; delay: number }) => {
      this.logger.warn(`Reconectando ao RabbitMQ (tentativa ${info.attempt}, em ${info.delay}ms)`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.connected = false;

    try {
      await this.channel?.close();
    } catch {
      this.logger.warn('Falha ao fechar o canal do RabbitMQ.');
    }

    try {
      await this.connection?.close();
    } catch {
      this.logger.warn('Falha ao fechar a conexão com o RabbitMQ.');
    }
  }

  isConnected(): boolean {
    return this.connected && this.channel !== null;
  }

  publish(message: NotificationQueuedMessage): Promise<void> {
    return this.publishConfirmed(NOTIFICATIONS_EXCHANGE, routingKeyFor(message.channel), message);
  }

  publishRetry(message: NotificationQueuedMessage, delayMs: number): Promise<void> {
    return this.publishConfirmed(
      RETRY_EXCHANGE,
      retryRoutingKeyFor(message.channel, delayMs),
      message,
      { headers: { 'x-retry-delay-ms': delayMs } },
    );
  }

  publishDead(message: NotificationQueuedMessage): Promise<void> {
    return this.publishConfirmed(DEAD_EXCHANGE, '', message, {
      headers: { 'x-death-reason': 'retries-exhausted' },
    });
  }

  async pullDead(limit: number): Promise<NotificationQueuedMessage[]> {
    const channel = this.requireChannel();
    const pulled: NotificationQueuedMessage[] = [];

    for (let count = 0; count < limit; count += 1) {
      const message = await channel.get(DEAD_QUEUE, { noAck: false });

      if (!message) {
        break;
      }

      const parsed = parseNotificationMessage(message.content);
      channel.ack(message);

      if (parsed) {
        pulled.push(parsed);
      }
    }

    return pulled;
  }

  async consume(queue: string, handler: ConsumedMessageHandler): Promise<void> {
    this.consumers.push({ queue, handler });

    if (this.channel) {
      await this.bindConsumer(this.channel, { queue, handler });
    }
  }

  private async onConnected(model: ChannelModel): Promise<void> {
    const channel = await model.createConfirmChannel();
    await channel.prefetch(1);
    await this.assertTopology(channel);

    for (const consumer of this.consumers) {
      await this.bindConsumer(channel, consumer);
    }

    this.channel = channel;
    this.connected = true;
    this.logger.log('Conectado ao RabbitMQ');
  }

  private async assertTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertExchange(NOTIFICATIONS_EXCHANGE, 'topic', { durable: true });
    await channel.assertExchange(RETRY_EXCHANGE, 'direct', { durable: true });
    await channel.assertExchange(DEAD_EXCHANGE, 'fanout', { durable: true });

    await channel.assertQueue(DEAD_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_QUEUE, DEAD_EXCHANGE, '');

    for (const consumedChannel of CONSUMED_CHANNELS) {
      const workQueue = queueFor(consumedChannel);
      await channel.assertQueue(workQueue, { durable: true });
      await channel.bindQueue(workQueue, NOTIFICATIONS_EXCHANGE, routingKeyFor(consumedChannel));

      for (const delayMs of RETRY_QUEUE_DELAYS_MS) {
        const waitQueue = retryQueueFor(consumedChannel, delayMs);
        await channel.assertQueue(waitQueue, {
          durable: true,
          messageTtl: delayMs,
          deadLetterExchange: NOTIFICATIONS_EXCHANGE,
          deadLetterRoutingKey: routingKeyFor(consumedChannel),
        });
        await channel.bindQueue(
          waitQueue,
          RETRY_EXCHANGE,
          retryRoutingKeyFor(consumedChannel, delayMs),
        );
      }
    }
  }

  private async bindConsumer(channel: ConfirmChannel, consumer: RegisteredConsumer): Promise<void> {
    await channel.consume(consumer.queue, (message) => {
      if (!message) {
        return;
      }

      void this.dispatch(channel, consumer.handler, message);
    });
  }

  private async dispatch(
    channel: ConfirmChannel,
    handler: ConsumedMessageHandler,
    message: ConsumeMessage,
  ): Promise<void> {
    try {
      await handler(message);
      channel.ack(message);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao processar mensagem; reenfileirando: ${reason}`);
      channel.nack(message, false, true);
    }
  }

  private publishConfirmed(
    exchange: string,
    routingKey: string,
    message: NotificationQueuedMessage,
    extras: Options.Publish = {},
  ): Promise<void> {
    const channel = this.requireChannel();
    const content = serializeNotificationMessage(message);

    return new Promise<void>((resolve, reject) => {
      channel.publish(
        exchange,
        routingKey,
        content,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: message.notificationId,
          ...extras,
        },
        (error) => {
          if (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          resolve();
        },
      );
    });
  }

  private requireChannel(): ConfirmChannel {
    if (!this.channel || !this.connected) {
      throw new ServiceUnavailableException('Sem conexão com o RabbitMQ.');
    }

    return this.channel;
  }
}
