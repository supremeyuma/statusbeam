import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { createPool } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

const TABLES = [
  'notification_failures',
  'incident_updates',
  'incidents',
  'checks',
  'rollups',
  'monitors',
  'channels',
  'api_keys',
  'refresh_tokens',
  'projects',
  'users',
];

export async function resetDatabase(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for integration tests');
  }

  await runMigrations(databaseUrl);
  const pool = createPool(databaseUrl);
  try {
    await pool.query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await pool.end();
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

export interface RegisteredUser {
  accessToken: string;
  user: { id: string; email: string };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}@example.com`;
}

export const TEST_PASSWORD = 'correct-horse-battery';

export async function registerUser(
  server: Server,
  email = uniqueEmail('user'),
): Promise<RegisteredUser> {
  const response = await request(server)
    .post('/v1/auth/register')
    .send({ email, password: TEST_PASSWORD })
    .expect(201);
  return response.body as RegisteredUser;
}
