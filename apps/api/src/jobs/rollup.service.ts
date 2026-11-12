import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE } from '../db/database.module';
import type { Database } from '../db/client';

export function floorToHour(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

export interface RollupResult {
  hourStart: Date;
  monitorsUpserted: number;
}

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  public constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Recomputes one UTC hour from raw checks. Recompute-and-upsert (not increment) keeps
   * reruns and backfills idempotent. p95 uses percentile_disc, i.e. nearest-rank.
   */
  public async rollupHour(hourStart: Date): Promise<RollupResult> {
    const start = floorToHour(hourStart);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const result = await this.db.execute(sql`
      INSERT INTO rollups (monitor_id, bucket_hour, up_count, down_count, p95_latency_ms, updated_at)
      SELECT
        monitor_id,
        ${start}::timestamptz,
        COUNT(*) FILTER (WHERE status = 'up')::int,
        COUNT(*) FILTER (WHERE status = 'down')::int,
        percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int,
        now()
      FROM checks
      WHERE checked_at >= ${start} AND checked_at < ${end}
      GROUP BY monitor_id
      ON CONFLICT (monitor_id, bucket_hour) DO UPDATE SET
        up_count = EXCLUDED.up_count,
        down_count = EXCLUDED.down_count,
        p95_latency_ms = EXCLUDED.p95_latency_ms,
        updated_at = now()
    `);

    const monitorsUpserted = result.rowCount ?? 0;
    this.logger.log(`rollup ${start.toISOString()} upserted ${monitorsUpserted} monitor buckets`);
    return { hourStart: start, monitorsUpserted };
  }

  public async backfill(days: number, now: Date = new Date()): Promise<RollupResult[]> {
    const endHour = floorToHour(now);
    const start = new Date(endHour.getTime() - days * 24 * 60 * 60 * 1000);
    const results: RollupResult[] = [];

    for (
      let cursor = start;
      cursor < endHour;
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000)
    ) {
      results.push(await this.rollupHour(cursor));
    }

    return results;
  }
}
