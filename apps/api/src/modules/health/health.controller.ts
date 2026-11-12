import { Controller, Get, HttpStatus, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';
import type Redis from 'ioredis';

import { PG_POOL } from '../../db/database.module';
import { REDIS } from '../../redis/redis.module';

export type DependencyState = 'up' | 'down';

export interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: {
    database: DependencyState;
    redis: DependencyState;
  };
}

const READINESS_TIMEOUT_MS = 1000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} check timed out after ${ms}ms`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  public constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('healthz')
  public healthz(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('readyz')
  public async readyz(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const checks: ReadinessResponse['checks'] = { database: 'down', redis: 'down' };

    try {
      await withTimeout(this.pool.query('SELECT 1'), READINESS_TIMEOUT_MS, 'database');
      checks.database = 'up';
    } catch (error) {
      this.logger.warn(
        `Database readiness failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      await withTimeout(this.redis.ping(), READINESS_TIMEOUT_MS, 'redis');
      checks.redis = 'up';
    } catch (error) {
      this.logger.warn(
        `Redis readiness failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const healthy = checks.database === 'up' && checks.redis === 'up';
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status: healthy ? 'ok' : 'error', checks };
  }
}
