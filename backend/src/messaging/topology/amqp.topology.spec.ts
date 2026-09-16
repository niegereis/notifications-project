import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { queueFor, retryQueueFor, retryRoutingKeyFor, routingKeyFor } from './amqp.topology.js';

describe('topologia AMQP', () => {
  it('nomeia fila e routing key pelo canal', () => {
    expect(routingKeyFor(NotificationChannel.EMAIL)).toBe('notification.email');
    expect(queueFor(NotificationChannel.SMS)).toBe('notifications.sms');
  });

  it('nomeia a fila de espera com o delay', () => {
    expect(retryQueueFor(NotificationChannel.PUSH, 5000)).toBe('notifications.push.retry.5000');
    expect(retryRoutingKeyFor(NotificationChannel.PUSH, 5000)).toBe('retry.push.5000');
  });
});
