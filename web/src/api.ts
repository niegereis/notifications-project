import type { CreateNotificationInput, NotificationItem, NotificationPage } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? '';
const API_KEY_HEADER = 'x-api-key';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (typeof body !== 'object' || body === null || !('message' in body)) {
    return fallback;
  }

  const message = (body as { message: unknown }).message;

  if (typeof message === 'string') {
    return message;
  }

  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(' ');
  }

  return fallback;
}

async function request<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [API_KEY_HEADER]: apiKey,
      ...init?.headers,
    },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, messageFrom(body, `HTTP ${response.status}`));
  }

  return body as T;
}

export function whoami(apiKey: string): Promise<{ client: string }> {
  return request('/auth/whoami', apiKey);
}

export function createNotification(
  apiKey: string,
  input: CreateNotificationInput,
): Promise<NotificationItem> {
  return request('/notifications', apiKey, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function redriveNotification(apiKey: string, id: string): Promise<NotificationItem> {
  return request(`/notifications/${id}/redrive`, apiKey, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function redriveDeadLetter(apiKey: string): Promise<{
  redriven: string[];
  discarded: number;
  returned: number;
}> {
  return request('/notifications/dead/redrive', apiKey, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function listNotifications(
  apiKey: string,
  page: number,
  pageSize: number,
): Promise<NotificationPage> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  return request(`/notifications?${query.toString()}`, apiKey);
}
