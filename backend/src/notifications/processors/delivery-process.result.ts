import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';

export type DeliveryProcessResult =
  | { kind: 'ignored' }
  | { kind: 'sent' }
  | { kind: 'retry'; delayMs: number; channel: NotificationChannel }
  | { kind: 'dead'; channel: NotificationChannel };
