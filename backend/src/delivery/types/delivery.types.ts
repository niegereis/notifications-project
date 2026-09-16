import type { NotificationChannel } from '../../common/enums/notification-channel.enum.js';

export interface DeliveryRequest {
  recipient: string;
  subject: string | null;
  body: string;
}

export interface DeliveryResult {
  providerMessageId: string;
}

export interface DeliveryProvider {
  readonly channel: NotificationChannel;
  send(request: DeliveryRequest): Promise<DeliveryResult>;
}

export class DeliveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DeliveryError';
  }
}
