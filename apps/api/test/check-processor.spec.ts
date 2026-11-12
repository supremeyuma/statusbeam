import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { DATABASE } from '../src/db/database.module';
import type { Database } from '../src/db/client';
import { checks, monitors, projects, users } from '../src/db/schema';
import { CheckProcessor } from '../src/jobs/check.processor';
import { createTestApp, resetDatabase } from './helpers/test-app';
import { startTargetServer, type TargetServer } from './fixtures/target-server';

describe('Check processor duplicate prevention', () => {
  let app: INestApplication;
  let db: Database;
  let processor: CheckProcessor;
  let target: TargetServer;
  let monitorId: string;

  beforeAll(async () => {
    await resetDatabase();
    target = await startTargetServer();
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
    processor = app.get(CheckProcessor);

    const [user] = await db
      .insert(users)
      .values({ email: 'processor@example.com', passwordHash: 'not-used' })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ userId: user!.id, name: 'Processor', slug: 'processor' })
      .returning();
    const [monitor] = await db
      .insert(monitors)
      .values({
        projectId: project!.id,
        name: 'target',
        type: 'http',
        config: {
          url: `${target.url}/ok`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
        intervalS: 60,
        timeoutMs: 2000,
        retries: 3,
      })
      .returning();
    monitorId = monitor!.id;
  });

  afterAll(async () => {
    await app.close();
    await target.close();
  });

  it('runs exactly one check when two workers race for the same monitor', async () => {
    const outcomes = await Promise.all([
      processor.process(monitorId),
      processor.process(monitorId),
    ]);

    expect(outcomes.sort()).toEqual(['checked', 'skipped']);

    const rows = await db.select().from(checks).where(eq(checks.monitorId, monitorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('up');

    const [monitor] = await db.select().from(monitors).where(eq(monitors.id, monitorId));
    expect(monitor!.lastStatus).toBe('up');
    expect(monitor!.lastCheckedAt).not.toBeNull();
  });

  it('can check again after the lock is released', async () => {
    await expect(processor.process(monitorId)).resolves.toBe('checked');
    const rows = await db.select().from(checks).where(eq(checks.monitorId, monitorId));
    expect(rows).toHaveLength(2);
  });

  it('skips inactive and missing monitors', async () => {
    await db.update(monitors).set({ active: false }).where(eq(monitors.id, monitorId));
    await expect(processor.process(monitorId)).resolves.toBe('inactive');

    await db.delete(monitors).where(eq(monitors.id, monitorId));
    await expect(processor.process(monitorId)).resolves.toBe('missing');
  });
});
