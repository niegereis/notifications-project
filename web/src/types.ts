export type Channel = 'EMAIL' | 'SMS' | 'PUSH';
export type Status = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';

export interface NotificationItem {
  id: string;
  channel: Channel;
  eventType: string;
  recipient: string;
  status: Status;
  requestedBy: string;
  subject: string | null;
  body: string;
  failureReason: string | null;
  sentAt: string | null;
  createdAt: string;
  callbackUrl: string | null;
}

export interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CreateNotificationInput {
  channel: Channel;
  eventType: string;
  recipient: string;
  payload: Record<string, unknown>;
  callbackUrl?: string;
}
