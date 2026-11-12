import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://statusbeam:statusbeam@localhost:5433/statusbeam',
  },
  strict: true,
  verbose: true,
});
