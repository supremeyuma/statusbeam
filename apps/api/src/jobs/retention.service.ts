import { Inject, Injectable, Logger } from '@nestjs/common';
import { lt } from 'drizzle-orm';

import { APP_CONFIG } from '../common/config.module';
import type { AppConfig } from '../common/config';
import { DATABASE } from '../db/database.module';
import type { Database } from '../db/client';
import { checks, rollups } from '../db/schema';

export interface RetentionResult {
  checksDeleted: number;
  rollupsDeleted: number;
  checkCutoff: Date;
  rollupCutoff: Date;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  public async run(now: Date = new Date()): Promise<RetentionResult> {
    const checkCutoff = new Date(
      now.getTime() - this.config.checkRetentionDays * 24 * 60 * 60 * 1000,
    );
    const rollupCutoff = new Date(
      now.getTime() - this.config.rollupRetentionDays * 24 * 60 * 60 * 1000,
    );

    const deletedChecks = await this.db.delete(checks).where(lt(checks.checkedAt, checkCutoff));
    const deletedRollups = await this.db
      .delete(rollups)
      .where(lt(rollups.bucketHour, rollupCutoff));

    const result: RetentionResult = {
      checksDeleted: deletedChecks.rowCount ?? 0,
      rollupsDeleted: deletedRollups.rowCount ?? 0,
      checkCutoff,
      rollupCutoff,
    };

    this.logger.log(
      `retention deleted checks=${result.checksDeleted} (before ${checkCutoff.toISOString()}) ` +
        `rollups=${result.rollupsDeleted} (before ${rollupCutoff.toISOString()})`,
    );

    return result;
  }
}
