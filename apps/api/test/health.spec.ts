import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { AppModule } from '../src/app.module';
import { PG_POOL } from '../src/db/database.module';
import { REDIS } from '../src/redis/redis.module';

const healthyPool = {
  query: () => Promise.resolve({ rows: [{ '?column?': 1 }] }),
  end: () => Promise.resolve(),
};

const healthyRedis = {
  status: 'ready',
  ping: () => Promise.resolve('PONG'),
  quit: () => Promise.resolve('OK'),
};

describe('Health and metrics (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL)
      .useValue(healthyPool)
      .overrideProvider(REDIS)
      .useValue(healthyRedis)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves liveness', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/healthz')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('serves readiness with dependency checks', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/readyz')
      .expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
  });

  it('exposes the http duration histogram after a request', async () => {
    await request(app.getHttpServer() as Server)
      .get('/')
      .expect(200);
    const response = await request(app.getHttpServer() as Server)
      .get('/metrics')
      .expect(200);
    expect(response.text).toContain('statusbeam_http_request_duration_seconds');
  });

  it('echoes a caller supplied request id', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/healthz')
      .set('X-Request-ID', 'caller-id-1')
      .expect(200);
    expect(response.headers['x-request-id']).toBe('caller-id-1');
  });
});

describe('Readiness when dependencies are down (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const brokenPool = {
      query: () => Promise.reject(new Error('postgres unavailable')),
      end: () => Promise.resolve(),
    };
    const brokenRedis = {
      status: 'close',
      ping: () => Promise.reject(new Error('redis unavailable')),
      quit: () => Promise.resolve('OK'),
    };

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL)
      .useValue(brokenPool)
      .overrideProvider(REDIS)
      .useValue(brokenRedis)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with both checks down', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/readyz')
      .expect(503);
    expect(response.body).toEqual({
      status: 'error',
      checks: { database: 'down', redis: 'down' },
    });
  });
});
