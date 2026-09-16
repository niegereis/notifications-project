import type { NotificationChannel } from '../src/common/enums/notification-channel.enum.js';

export class FakeNotificationPublisher {
  readonly published: Array<{ id: string; channel: NotificationChannel }> = [];
  failNextWith: string | null = null;

  publish(notification: { id: string; channel: NotificationChannel }): Promise<void> {
    if (this.failNextWith) {
      const reason = this.failNextWith;
      this.failNextWith = null;

      return Promise.reject(new Error(reason));
    }

    this.published.push({ id: notification.id, channel: notification.channel });

    return Promise.resolve();
  }
}
