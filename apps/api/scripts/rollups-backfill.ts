import 'reflect-metadata';

import { loadConfig } from '../src/common/config';
import { loadEnvFiles } from '../src/common/load-env';
import { createDatabase, createPool } from '../src/db/client';
import { RollupService } from '../src/jobs/rollup.service';

function readDays(argv: string[]): number {
  const index = argv.indexOf('--days');
  if (index === -1) {
    return 7;
  }
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 90) {
    throw new Error('--days must be an integer between 1 and 90');
  }
  return value;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const days = readDays(process.argv.slice(2));
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  try {
    const rollup = new RollupService(createDatabase(pool));
    const results = await rollup.backfill(days);
    const total = results.reduce((sum, result) => sum + result.monitorsUpserted, 0);
    console.log(`Backfilled ${results.length} hours, ${total} monitor-hour buckets`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Rollup backfill failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
