import { NotificationChannel } from '../src/common/enums/notification-channel.enum.js';
import {
  DeliveryError,
  type DeliveryProvider,
  type DeliveryRequest,
  type DeliveryResult,
} from '../src/delivery/types/delivery.types.js';

export class FakeEmailProvider implements DeliveryProvider {
  readonly channel = NotificationChannel.EMAIL;
  readonly sent: DeliveryRequest[] = [];
  failNextWith: string | null = null;
  failuresRemaining = 0;

  send(request: DeliveryRequest): Promise<DeliveryResult> {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return Promise.reject(new DeliveryError(this.failNextWith ?? 'falha simulada'));
    }

    if (this.failNextWith) {
      const reason = this.failNextWith;
      this.failNextWith = null;

      return Promise.reject(new DeliveryError(reason));
    }

    this.sent.push(request);

    return Promise.resolve({ providerMessageId: `fake-${this.sent.length}` });
  }
}
