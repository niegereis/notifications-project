import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('expõe aceitas, enviadas e retries no formato Prometheus', async () => {
    const metrics = new MetricsService();

    metrics.recordAccepted(NotificationChannel.EMAIL);
    metrics.recordSent(NotificationChannel.EMAIL, new Date(Date.now() - 200), 50);
    metrics.recordRetry(NotificationChannel.SMS, 10);
    metrics.recordFailed(NotificationChannel.PUSH, 20);
    metrics.recordReplay(NotificationChannel.EMAIL);
    metrics.recordEnqueueFailed(NotificationChannel.EMAIL);
    metrics.recordRedriven(NotificationChannel.EMAIL);
    metrics.recordWebhookDelivered(NotificationChannel.SMS);
    metrics.recordWebhookFailed(NotificationChannel.PUSH);

    const body = await metrics.render();

    expect(body).toContain('notifications_accepted_total{channel="EMAIL"} 1');
    expect(body).toContain('notifications_sent_total{channel="EMAIL"} 1');
    expect(body).toContain('notifications_retries_total{channel="SMS"} 1');
    expect(body).toContain('notifications_failed_total{channel="PUSH"} 1');
    expect(body).toContain('notifications_replayed_total{channel="EMAIL"} 1');
    expect(body).toContain('notifications_enqueue_failed_total{channel="EMAIL"} 1');
    expect(body).toContain('notifications_redriven_total{channel="EMAIL"} 1');
    expect(body).toContain('notification_webhooks_delivered_total{channel="SMS"} 1');
    expect(body).toContain('notification_webhooks_failed_total{channel="PUSH"} 1');
    expect(body).toContain('# TYPE notification_delivery_duration_seconds histogram');
    expect(metrics.contentType()).toContain('text/plain');
  });
});
