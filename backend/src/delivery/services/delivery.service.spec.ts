import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { DeliveryService } from './delivery.service.js';
import type { DeliveryProvider, DeliveryRequest, DeliveryResult } from '../types/delivery.types.js';

class StubProvider implements DeliveryProvider {
  readonly sent: DeliveryRequest[] = [];

  constructor(readonly channel: NotificationChannel) {}

  send(request: DeliveryRequest): Promise<DeliveryResult> {
    this.sent.push(request);
    return Promise.resolve({ providerMessageId: `${this.channel}-1` });
  }
}

describe('DeliveryService', () => {
  it('escolhe a estratégia pelo canal', async () => {
    const email = new StubProvider(NotificationChannel.EMAIL);
    const sms = new StubProvider(NotificationChannel.SMS);
    const push = new StubProvider(NotificationChannel.PUSH);
    const delivery = new DeliveryService([email, sms, push]);

    await delivery.send(NotificationChannel.SMS, {
      recipient: '+5511999999999',
      subject: null,
      body: 'Pedido a caminho',
    });

    expect(sms.sent).toHaveLength(1);
    expect(email.sent).toHaveLength(0);
    expect(push.sent).toHaveLength(0);
  });

  it('reconhece os três canais', () => {
    const delivery = new DeliveryService([
      new StubProvider(NotificationChannel.EMAIL),
      new StubProvider(NotificationChannel.SMS),
      new StubProvider(NotificationChannel.PUSH),
    ]);

    expect(delivery.supports(NotificationChannel.EMAIL)).toBe(true);
    expect(delivery.supports(NotificationChannel.SMS)).toBe(true);
    expect(delivery.supports(NotificationChannel.PUSH)).toBe(true);
  });
});
