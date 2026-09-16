import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '../../redis/services/redis.service.js';

export interface IdempotencyRecord {
  fingerprint: string;
  notificationId?: string;
}

export type IdempotencyReservation =
  { kind: 'acquired' } | { kind: 'replay'; notificationId: string };

const KEY_PREFIX = 'idempotency';

@Injectable()
export class IdempotencyService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly redis: RedisService,
    configService: ConfigService,
  ) {
    this.ttlSeconds = configService.get<number>('IDEMPOTENCY_TTL_SECONDS') ?? 86_400;
  }

  async reserve(
    client: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<IdempotencyReservation> {
    const redisKey = this.redisKey(client, idempotencyKey);
    const acquired = await this.redis.setNx(
      redisKey,
      JSON.stringify({ fingerprint } satisfies IdempotencyRecord),
      this.ttlSeconds,
    );

    if (acquired) {
      return { kind: 'acquired' };
    }

    const stored = await this.read(redisKey);

    if (!stored) {
      throw new ServiceUnavailableException(
        'Não foi possível garantir a idempotência. Tente de novo.',
      );
    }

    if (stored.fingerprint !== fingerprint) {
      throw new ConflictException(
        'Idempotency-Key já foi usada com um pedido diferente. Use outra chave.',
      );
    }

    if (!stored.notificationId) {
      throw new ConflictException('Pedido com esta Idempotency-Key ainda está em andamento.');
    }

    return { kind: 'replay', notificationId: stored.notificationId };
  }

  async commit(client: string, idempotencyKey: string, notificationId: string): Promise<void> {
    const redisKey = this.redisKey(client, idempotencyKey);
    const stored = await this.read(redisKey);

    if (!stored) {
      return;
    }

    await this.redis.set(
      redisKey,
      JSON.stringify({
        fingerprint: stored.fingerprint,
        notificationId,
      } satisfies IdempotencyRecord),
      this.ttlSeconds,
    );
  }

  async release(client: string, idempotencyKey: string): Promise<void> {
    await this.redis.del(this.redisKey(client, idempotencyKey));
  }

  private async read(redisKey: string): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.get(redisKey);

    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }

      const fingerprint = (parsed as { fingerprint?: unknown }).fingerprint;
      const notificationId = (parsed as { notificationId?: unknown }).notificationId;

      if (typeof fingerprint !== 'string') {
        return null;
      }

      return {
        fingerprint,
        notificationId: typeof notificationId === 'string' ? notificationId : undefined,
      };
    } catch {
      return null;
    }
  }

  private redisKey(client: string, idempotencyKey: string): string {
    return `${KEY_PREFIX}:${client}:${idempotencyKey}`;
  }
}
