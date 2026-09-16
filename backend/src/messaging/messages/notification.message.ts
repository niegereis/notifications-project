import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';

export interface NotificationQueuedMessage {
  notificationId: string;
  channel: NotificationChannel;
}

export function serializeNotificationMessage(message: NotificationQueuedMessage): Buffer {
  return Buffer.from(JSON.stringify(message), 'utf8');
}

export function parseNotificationMessage(content: Buffer): NotificationQueuedMessage | null {
  try {
    const parsed: unknown = JSON.parse(content.toString('utf8'));

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const notificationId = (parsed as { notificationId?: unknown }).notificationId;
    const channel = (parsed as { channel?: unknown }).channel;

    if (typeof notificationId !== 'string' || notificationId.length === 0) {
      return null;
    }

    if (!isNotificationChannel(channel)) {
      return null;
    }

    return { notificationId, channel };
  } catch {
    return null;
  }
}

function isNotificationChannel(value: unknown): value is NotificationChannel {
  return (
    value === NotificationChannel.EMAIL ||
    value === NotificationChannel.SMS ||
    value === NotificationChannel.PUSH
  );
}
