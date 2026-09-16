import { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { NotificationStatus } from '../../common/enums/notification-status.enum.js';
import type { Notification } from '../entities/notification.entity.js';
import { toNotificationResponse } from './notification.response.js';

describe('toNotificationResponse', () => {
  it('expõe só os campos públicos, sem o payload', () => {
    const createdAt = new Date('2026-09-16T12:00:00.000Z');

    const response = toNotificationResponse({
      id: 'n-1',
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      payload: { nome: 'Ana' },
      status: NotificationStatus.PENDING,
      requestedBy: 'billing',
      subject: 'Olá',
      body: 'Bem-vinda',
      callbackUrl: 'https://billing.exemplo/hooks',
      failureReason: null,
      sentAt: null,
      createdAt,
      attempts: [
        {
          attemptNumber: 1,
          status: 'SUCCESS',
          error: null,
          providerMessageId: 'smtp-1',
          durationMs: 12,
          createdAt,
        },
      ],
    } as unknown as Notification);

    expect(response).toEqual({
      id: 'n-1',
      channel: NotificationChannel.EMAIL,
      eventType: 'user.welcome',
      recipient: 'ana@exemplo.com',
      status: NotificationStatus.PENDING,
      requestedBy: 'billing',
      subject: 'Olá',
      body: 'Bem-vinda',
      callbackUrl: 'https://billing.exemplo/hooks',
      failureReason: null,
      sentAt: null,
      createdAt,
      attempts: [
        {
          attemptNumber: 1,
          status: 'SUCCESS',
          error: null,
          providerMessageId: 'smtp-1',
          durationMs: 12,
          createdAt,
        },
      ],
    });
    expect(response).not.toHaveProperty('payload');
  });
});
