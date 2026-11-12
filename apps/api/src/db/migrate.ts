import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { loadConfig } from '../common/config';
import { createDatabase, createPool } from './client';

export function migrationsFolder(): string {
  return resolve(__dirname, '../../drizzle/migrations');
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const config = loadConfig();
  runMigrations(config.databaseUrl)
    .then(() => {
      console.log('Migrations applied');
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
