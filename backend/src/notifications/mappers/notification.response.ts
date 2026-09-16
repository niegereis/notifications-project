import type { DeliveryAttempt } from '../entities/delivery-attempt.entity.js';
import type { Notification } from '../entities/notification.entity.js';

export interface DeliveryAttemptResponse {
  attemptNumber: number;
  status: string;
  error: string | null;
  providerMessageId: string | null;
  durationMs: number;
  createdAt: Date;
}

export interface NotificationResponse {
  id: string;
  channel: string;
  eventType: string;
  recipient: string;
  status: string;
  requestedBy: string;
  subject: string | null;
  body: string;
  callbackUrl: string | null;
  failureReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  attempts?: DeliveryAttemptResponse[];
}

export interface NotificationPageResponse {
  items: NotificationResponse[];
  page: number;
  pageSize: number;
  total: number;
}

export function toNotificationResponse(
  notification: Notification & { attempts?: DeliveryAttempt[] | null },
): NotificationResponse {
  return {
    id: notification.id,
    channel: notification.channel,
    eventType: notification.eventType,
    recipient: notification.recipient,
    status: notification.status,
    requestedBy: notification.requestedBy,
    subject: notification.subject,
    body: notification.body,
    callbackUrl: notification.callbackUrl,
    failureReason: notification.failureReason,
    sentAt: notification.sentAt,
    createdAt: notification.createdAt,
    attempts: notification.attempts?.map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      status: attempt.status,
      error: attempt.error,
      providerMessageId: attempt.providerMessageId,
      durationMs: attempt.durationMs,
      createdAt: attempt.createdAt,
    })),
  };
}
