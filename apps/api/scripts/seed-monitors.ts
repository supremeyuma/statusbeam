import 'reflect-metadata';

import { loadConfig } from '../src/common/config';
import { loadEnvFiles } from '../src/common/load-env';
import { createDatabase, createPool } from '../src/db/client';
import { monitors, projects, users } from '../src/db/schema';
import { createQueue } from '../src/jobs/jobs.module';
import { CHECKS_QUEUE_NAME } from '../src/jobs/jobs.tokens';
import { SchedulerService } from '../src/jobs/scheduler.service';

function readArg(argv: string[], name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  return value ?? fallback;
}

async function main(): Promise<void> {
  loadEnvFiles();
  process.env.JOBS_ENABLED ??= 'true';

  const argv = process.argv.slice(2);
  const count = Number(readArg(argv, 'count', '5000'));
  const intervalS = Number(readArg(argv, 'interval', '30'));
  const target = readArg(argv, 'target', 'http://host.docker.internal:9099/health');

  if (!Number.isInteger(count) || count < 1 || count > 20_000) {
    throw new Error('--count must be between 1 and 20000');
  }

  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = createDatabase(pool);
  const queue = createQueue(CHECKS_QUEUE_NAME, config.redisUrl);
  const scheduler = new SchedulerService(config, queue);

  try {
    const slug = `load-${Date.now()}`;
    const [user] = await db
      .insert(users)
      .values({ email: `${slug}@example.com`, passwordHash: 'load-test-no-login' })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ userId: user!.id, name: `Load ${count}`, slug, public: false })
      .returning();

    const started = Date.now();
    const chunkSize = 250;
    const monitorIds: string[] = [];

    for (let offset = 0; offset < count; offset += chunkSize) {
      const size = Math.min(chunkSize, count - offset);
      const rows = await db
        .insert(monitors)
        .values(
          Array.from({ length: size }, (_, index) => ({
            projectId: project!.id,
            name: `load-${offset + index}`,
            type: 'http' as const,
            config: {
              url: target,
              method: 'GET',
              expectedStatus: [200],
              followRedirects: false,
            },
            intervalS,
            timeoutMs: 2000,
            retries: 2,
            active: true,
          })),
        )
        .returning({ id: monitors.id });
      monitorIds.push(...rows.map((row) => row.id));
    }

    for (const id of monitorIds) {
      await scheduler.sync({ id, intervalS, active: true });
    }

    console.log(
      JSON.stringify({
        projectId: project!.id,
        slug,
        monitors: monitorIds.length,
        intervalS,
        target,
        seedSeconds: (Date.now() - started) / 1000,
      }),
    );
  } finally {
    await queue.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
