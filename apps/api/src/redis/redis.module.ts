import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          connectTimeout: 1000,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  public constructor(@Inject(REDIS) private readonly redis: Redis) {}

  public async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'end') {
      return;
    }
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
