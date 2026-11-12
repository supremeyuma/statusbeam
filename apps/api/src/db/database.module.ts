import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';
import { createDatabase, createPool } from './client';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.databaseUrl),
    },
    {
      provide: DATABASE,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => createDatabase(pool),
    },
  ],
  exports: [PG_POOL, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  public constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
