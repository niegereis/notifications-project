import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: RedisClientType;

  constructor(configService: ConfigService) {
    this.client = createClient({
      url: configService.getOrThrow<string>('REDIS_URL'),
    });
    this.client.on('error', (error: Error) => {
      this.logger.error(`Redis: ${error.message}`);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Conectado ao Redis');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  isReady(): boolean {
    return this.client.isReady;
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<string | null> {
    return this.client.set(key, value, { expiration: { type: 'EX', value: ttlSeconds } });
  }

  async setNx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, value, {
      expiration: { type: 'EX', value: ttlSeconds },
      condition: 'NX',
    });

    return result !== null;
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    return (await this.client.expire(key, ttlSeconds)) === 1;
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  ping(): Promise<string> {
    return this.client.ping();
  }

  flushDb(): Promise<string> {
    return this.client.flushDb();
  }
}
