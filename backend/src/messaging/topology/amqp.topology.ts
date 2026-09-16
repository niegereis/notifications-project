import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { RETRY_DELAYS_MS } from '../policies/retry.policy.js';

export const NOTIFICATIONS_EXCHANGE = 'notifications';
export const RETRY_EXCHANGE = 'notifications.retry';
export const DEAD_EXCHANGE = 'notifications.dead';
export const DEAD_QUEUE = 'notifications.dead';

export const CONSUMED_CHANNELS = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
] as const;

export function routingKeyFor(channel: NotificationChannel): string {
  return `notification.${channel.toLowerCase()}`;
}

export function queueFor(channel: NotificationChannel): string {
  return `notifications.${channel.toLowerCase()}`;
}

export function retryQueueFor(channel: NotificationChannel, delayMs: number): string {
  return `notifications.${channel.toLowerCase()}.retry.${delayMs}`;
}

export function retryRoutingKeyFor(channel: NotificationChannel, delayMs: number): string {
  return `retry.${channel.toLowerCase()}.${delayMs}`;
}

export const RETRY_QUEUE_DELAYS_MS: readonly number[] = RETRY_DELAYS_MS;
