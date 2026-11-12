import 'reflect-metadata';

import { like } from 'drizzle-orm';

import { loadConfig } from '../src/common/config';
import { loadEnvFiles } from '../src/common/load-env';
import { createDatabase, createPool } from '../src/db/client';
import { projects } from '../src/db/schema';
import { createQueue } from '../src/jobs/jobs.module';
import { CHECKS_QUEUE_NAME } from '../src/jobs/jobs.tokens';

async function main(): Promise<void> {
  loadEnvFiles();
  process.env.JOBS_ENABLED ??= 'true';
  const config = loadConfig();
  const queue = createQueue(CHECKS_QUEUE_NAME, config.redisUrl);
  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);

  try {
    const schedulers = await queue.getJobSchedulers(0, -1, true);
    let removed = 0;
    for (const scheduler of schedulers) {
      if (scheduler.key.startsWith('monitor:')) {
        await queue.removeJobScheduler(scheduler.key);
        removed += 1;
      }
    }

    const deleted = await db.delete(projects).where(like(projects.slug, 'load-%')).returning({
      id: projects.id,
    });

    console.log(`Removed ${removed} monitor schedulers and ${deleted.length} load projects`);
  } finally {
    await queue.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Cleanup failed:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
