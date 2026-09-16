import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { AmqpService } from '../../messaging/services/amqp.service.js';
import { NotificationProcessor } from '../../notifications/processors/notification.processor.js';
import { NotificationConsumer } from './notification.consumer.js';

const EMAIL_MESSAGE = Buffer.from(
  JSON.stringify({ notificationId: 'n-1', channel: NotificationChannel.EMAIL }),
);

describe('NotificationConsumer', () => {
  it('processa o id da mensagem válida', async () => {
    const processed: string[] = [];
    const processor = {
      process: (id: string) => {
        processed.push(id);
        return Promise.resolve({ kind: 'sent' });
      },
    } as unknown as NotificationProcessor;

    const consumer = new NotificationConsumer({} as AmqpService, processor);

    await consumer.handle(EMAIL_MESSAGE);

    expect(processed).toEqual(['n-1']);
  });

  it('publica na fila de espera quando o processor pede retry', async () => {
    const retried: Array<{ id: string; delayMs: number }> = [];
    const processor = {
      process: () =>
        Promise.resolve({
          kind: 'retry',
          delayMs: 1_000,
          channel: NotificationChannel.EMAIL,
        }),
    } as unknown as NotificationProcessor;
    const amqp = {
      publishRetry: (message: { notificationId: string }, delayMs: number) => {
        retried.push({ id: message.notificationId, delayMs });
        return Promise.resolve();
      },
    } as unknown as AmqpService;

    const consumer = new NotificationConsumer(amqp, processor);

    await consumer.handle(EMAIL_MESSAGE);

    expect(retried).toEqual([{ id: 'n-1', delayMs: 1_000 }]);
  });

  it('publica na fila morta quando as tentativas esgotam', async () => {
    const dead: string[] = [];
    const processor = {
      process: () => Promise.resolve({ kind: 'dead', channel: NotificationChannel.EMAIL }),
    } as unknown as NotificationProcessor;
    const amqp = {
      publishDead: (message: { notificationId: string }) => {
        dead.push(message.notificationId);
        return Promise.resolve();
      },
    } as unknown as AmqpService;

    const consumer = new NotificationConsumer(amqp, processor);

    await consumer.handle(EMAIL_MESSAGE);

    expect(dead).toEqual(['n-1']);
  });

  it('descarta mensagem inválida sem chamar o processor', async () => {
    const processed: string[] = [];
    const processor = {
      process: (id: string) => {
        processed.push(id);
        return Promise.resolve({ kind: 'sent' });
      },
    } as unknown as NotificationProcessor;

    const consumer = new NotificationConsumer({} as AmqpService, processor);

    await consumer.handle(Buffer.from('não é json'));

    expect(processed).toEqual([]);
  });
});
