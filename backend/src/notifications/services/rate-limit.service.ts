import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { NotificationChannel } from '../../common/enums/notification-channel.enum.js';
import { RedisService } from '../../redis/services/redis.service.js';
import { RateLimitedException } from '../exceptions/rate-limited.exception.js';

const KEY_PREFIX = 'ratelimit';

@Injectable()
export class RateLimitService {
  private readonly max: number;
  private readonly windowSeconds: number;

  constructor(
    private readonly redis: RedisService,
    configService: ConfigService,
  ) {
    this.max = configService.get<number>('RATE_LIMIT_MAX') ?? 10;
    this.windowSeconds = configService.get<number>('RATE_LIMIT_WINDOW_SECONDS') ?? 60;
  }

  async consume(channel: NotificationChannel, recipient: string): Promise<void> {
    const key = `${KEY_PREFIX}:${channel}:${recipient}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, this.windowSeconds);
    }

    if (count > this.max) {
      const ttl = await this.redis.ttl(key);
      throw new RateLimitedException(ttl > 0 ? ttl : this.windowSeconds);
    }
  }
}
