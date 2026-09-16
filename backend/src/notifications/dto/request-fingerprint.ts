import { createHash } from 'node:crypto';

import type { CreateNotificationDto } from './create-notification.dto.js';

export function fingerprintOf(dto: CreateNotificationDto): string {
  const payload = dto.payload ?? {};
  const canonicalPayload = Object.keys(payload)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = payload[key];
      return acc;
    }, {});

  return createHash('sha256')
    .update(
      JSON.stringify({
        channel: dto.channel,
        eventType: dto.eventType,
        recipient: dto.recipient,
        payload: canonicalPayload,
        callbackUrl: dto.callbackUrl ?? null,
      }),
    )
    .digest('hex');
}
