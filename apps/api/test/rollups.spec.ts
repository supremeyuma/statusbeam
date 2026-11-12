import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { DATABASE } from '../src/db/database.module';
import type { Database } from '../src/db/client';
import { checks, monitors, projects, rollups, users } from '../src/db/schema';
import { RetentionService } from '../src/jobs/retention.service';
import { RollupService } from '../src/jobs/rollup.service';
import { createTestApp, resetDatabase } from './helpers/test-app';

const HOUR = new Date('2026-01-01T10:00:00.000Z');

describe('Rollups and retention', () => {
  let app: INestApplication;
  let db: Database;
  let rollup: RollupService;
  let retention: RetentionService;
  let monitorId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
    rollup = app.get(RollupService);
    retention = app.get(RetentionService);

    const [user] = await db
      .insert(users)
      .values({ email: 'rollup@example.com', passwordHash: 'not-used' })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ userId: user!.id, name: 'Rollups', slug: 'rollups' })
      .returning();
    const [monitor] = await db
      .insert(monitors)
      .values({
        projectId: project!.id,
        name: 'rollup target',
        type: 'http',
        config: {
          url: 'http://127.0.0.1:9',
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      })
      .returning();
    monitorId = monitor!.id;

    const latencies = [10, 20, 30, 40, 50];
    const statuses = ['up', 'up', 'down', 'up', 'up'] as const;
    await db.insert(checks).values(
      latencies.map((latencyMs, index) => ({
        monitorId,
        status: statuses[index]!,
        latencyMs,
        checkedAt: new Date(HOUR.getTime() + (index + 1) * 60_000),
      })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('computes counts and nearest-rank p95 for one hour', async () => {
    await rollup.rollupHour(HOUR);

    const rows = await db.select().from(rollups).where(eq(rollups.monitorId, monitorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.upCount).toBe(4);
    expect(rows[0]!.downCount).toBe(1);
    expect(rows[0]!.p95LatencyMs).toBe(50);
  });

  it('is idempotent when the same hour is recomputed', async () => {
    await rollup.rollupHour(HOUR);
    await rollup.rollupHour(HOUR);

    const rows = await db.select().from(rollups).where(eq(rollups.monitorId, monitorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.upCount).toBe(4);
    expect(rows[0]!.downCount).toBe(1);
  });

  it('backfills every hour so totals match raw checks', async () => {
    const secondHour = new Date(HOUR.getTime() + 60 * 60 * 1000);
    await db.insert(checks).values([
      {
        monitorId,
        status: 'up',
        latencyMs: 15,
        checkedAt: new Date(secondHour.getTime() + 60_000),
      },
      {
        monitorId,
        status: 'up',
        latencyMs: 25,
        checkedAt: new Date(secondHour.getTime() + 120_000),
      },
    ]);

    await rollup.rollupHour(HOUR);
    await rollup.rollupHour(secondHour);

    const [raw] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(checks)
      .where(eq(checks.monitorId, monitorId));
    const [rolled] = await db
      .select({
        up: sql<number>`coalesce(sum(${rollups.upCount}), 0)::int`,
        down: sql<number>`coalesce(sum(${rollups.downCount}), 0)::int`,
      })
      .from(rollups)
      .where(eq(rollups.monitorId, monitorId));

    expect((rolled?.up ?? 0) + (rolled?.down ?? 0)).toBe(raw?.total);
    expect(rolled?.up).toBe(6);
    expect(rolled?.down).toBe(1);
  });

  it('retention deletes only rows older than the configured windows', async () => {
    const now = new Date('2026-01-03T12:00:00.000Z');
    const oldCheck = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const recentCheck = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    const oldBucket = new Date(now.getTime() - 100 * 24 * 60 * 60 * 1000);
    const recentBucket = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

    await db.insert(checks).values([
      { monitorId, status: 'up', latencyMs: 5, checkedAt: oldCheck },
      { monitorId, status: 'up', latencyMs: 5, checkedAt: recentCheck },
    ]);
    await db.insert(rollups).values([
      { monitorId, bucketHour: oldBucket, upCount: 1, downCount: 0 },
      { monitorId, bucketHour: recentBucket, upCount: 1, downCount: 0 },
    ]);

    const result = await retention.run(now);
    expect(result.checksDeleted).toBe(1);
    expect(result.rollupsDeleted).toBe(1);

    const remainingChecks = await db.select().from(checks).where(eq(checks.monitorId, monitorId));
    expect(remainingChecks.some((row) => row.checkedAt.getTime() === oldCheck.getTime())).toBe(
      false,
    );

    const remainingRollups = await db
      .select()
      .from(rollups)
      .where(eq(rollups.monitorId, monitorId));
    expect(remainingRollups.some((row) => row.bucketHour.getTime() === oldBucket.getTime())).toBe(
      false,
    );
  });
});
