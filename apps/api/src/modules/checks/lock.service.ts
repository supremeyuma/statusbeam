import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';

import { REDIS } from '../../redis/redis.module';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class LockService {
  public constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Returns the lock owner token when acquired, or null when another worker holds it.
   * The compare-and-delete release prevents deleting a lock that expired and was re-acquired.
   */
  public async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', Math.max(ttlMs, 1), 'NX');
    return result === 'OK' ? token : null;
  }

  public async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RELEASE_SCRIPT, 1, key, token);
  }
}
