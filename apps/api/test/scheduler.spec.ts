import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { SchedulerService } from '../src/jobs/scheduler.service';
import { CHECKS_QUEUE } from '../src/jobs/jobs.tokens';
import type { Queue } from 'bullmq';
import { createTestApp, resetDatabase } from './helpers/test-app';

describe('BullMQ monitor scheduling', () => {
  let app: INestApplication;
  let scheduler: SchedulerService;
  let queue: Queue | null;
  const monitorId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'true';
    await resetDatabase();
    app = await createTestApp();
    scheduler = app.get(SchedulerService);
    queue = app.get<Queue | null>(CHECKS_QUEUE);
  });

  afterAll(async () => {
    await scheduler.remove(monitorId);
    await app.close();
    process.env.JOBS_ENABLED = 'false';
  });

  it('creates one repeatable job per monitor and updates it in place', async () => {
    await scheduler.sync({ id: monitorId, intervalS: 60, active: true });
    await scheduler.sync({ id: monitorId, intervalS: 120, active: true });

    const ids = await scheduler.listSchedulerIds();
    expect(ids.filter((id) => id.includes(monitorId))).toHaveLength(1);

    const schedulers = await queue!.getJobSchedulers(0, -1, true);
    const schedulerEntry = schedulers.find((entry) => entry.key.includes(monitorId));
    expect(schedulerEntry?.every).toBe(120_000);
  });

  it('removes the schedule when a monitor is paused or deleted', async () => {
    await scheduler.sync({ id: monitorId, intervalS: 60, active: false });

    const ids = await scheduler.listSchedulerIds();
    expect(ids.filter((id) => id.includes(monitorId))).toHaveLength(0);
  });
});
