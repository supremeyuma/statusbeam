import { get } from 'node:http';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type Redis from 'ioredis';

import { DATABASE } from '../src/db/database.module';
import type { Database } from '../src/db/client';
import { monitors, rollups } from '../src/db/schema';
import { REDIS } from '../src/redis/redis.module';
import { StatusEventsService } from '../src/modules/status/status-events.service';
import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

interface SseClient {
  buffer: () => string;
  waitFor: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<string>;
  close: () => void;
}

function openSse(port: number, slug: string, lastEventId?: string): Promise<SseClient> {
  return new Promise((resolve, reject) => {
    const request = get(
      {
        host: '127.0.0.1',
        port,
        path: `/v1/projects/${slug}/stream`,
        headers: {
          accept: 'text/event-stream',
          ...(lastEventId ? { 'last-event-id': lastEventId } : {}),
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });

        const waitFor = async (
          predicate: (value: string) => boolean,
          timeoutMs = 5000,
        ): Promise<string> => {
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            if (predicate(text)) {
              return text;
            }
            await new Promise((done) => setTimeout(done, 25));
          }
          throw new Error(`SSE wait timed out; buffer was:\n${text}`);
        };

        resolve({
          buffer: () => text,
          waitFor,
          close: () => {
            response.destroy();
            request.destroy();
          },
        });
      },
    );
    request.on('error', reject);
  });
}

describe('Public status API and SSE', () => {
  let app: INestApplication;
  let db: Database;
  let redis: Redis;
  let events: StatusEventsService;
  let port: number;
  let token: string;
  let slug: string;
  let projectId: string;
  let monitorId: string;
  let privateSlug: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
    db = app.get<Database>(DATABASE);
    redis = app.get<Redis>(REDIS);
    events = app.get(StatusEventsService);

    token = (await registerUser(server())).accessToken;
    const project = await request(server())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Public Demo', public: true })
      .expect(201);
    slug = project.body.slug as string;
    projectId = project.body.id as string;

    const monitor = await request(server())
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        name: 'API health',
        type: 'http',
        intervalS: 60,
        config: {
          url: 'http://127.0.0.1:9/health',
          headers: { authorization: 'Bearer monitor-secret-token' },
        },
      })
      .expect(201);
    monitorId = monitor.body.id as string;

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    yesterday.setUTCMinutes(0, 0, 0);
    await db.insert(rollups).values({
      monitorId,
      bucketHour: yesterday,
      upCount: 9,
      downCount: 1,
      p95LatencyMs: 120,
    });

    const privateProject = await request(server())
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Private Demo' })
      .expect(201);
    privateSlug = privateProject.body.slug as string;

    await request(server())
      .post('/v1/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        type: 'webhook',
        config: { url: 'http://127.0.0.1:9/hook', secret: 'webhook-secret-value' },
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  function server(): Server {
    return app.getHttpServer() as Server;
  }

  it('returns an allowlisted public snapshot with 90-day uptime', async () => {
    const response = await request(server()).get(`/v1/projects/${slug}/status`).expect(200);

    expect(response.headers.etag).toBeTruthy();
    expect(response.headers['cache-control']).toBe('public, max-age=10');
    expect(response.body.project.slug).toBe(slug);
    expect(response.body.monitors).toHaveLength(1);
    expect(response.body.monitors[0].uptime90d).toBe(90);
    expect(response.body.monitors[0].days).toHaveLength(90);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('monitor-secret-token');
    expect(raw).not.toContain('webhook-secret-value');
    expect(raw).not.toContain('/health');
    expect(raw).not.toContain('127.0.0.1');
  });

  it('honours If-None-Match with a 304', async () => {
    const first = await request(server()).get(`/v1/projects/${slug}/status`).expect(200);
    await request(server())
      .get(`/v1/projects/${slug}/status`)
      .set('If-None-Match', first.headers.etag as string)
      .expect(304);
  });

  it('hides private projects', async () => {
    await request(server()).get(`/v1/projects/${privateSlug}/status`).expect(404);
  });

  it('caches for 10 seconds and refreshes when the cache expires', async () => {
    const first = await request(server()).get(`/v1/projects/${slug}/status`).expect(200);
    const originalName = first.body.monitors[0].name as string;

    await db
      .update(monitors)
      .set({ name: 'Renamed after cache' })
      .where(eq(monitors.id, monitorId));

    const cached = await request(server()).get(`/v1/projects/${slug}/status`).expect(200);
    expect(cached.body.monitors[0].name).toBe(originalName);
    const ttl = await redis.ttl(`status:cache:${slug}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10);

    await redis.del(`status:cache:${slug}`);
    const refreshed = await request(server()).get(`/v1/projects/${slug}/status`).expect(200);
    expect(refreshed.body.monitors[0].name).toBe('Renamed after cache');
  });

  it('streams a snapshot on connect', async () => {
    const client = await openSse(port, slug);
    try {
      const text = await client.waitFor((value) => value.includes('event: snapshot'));
      expect(text).toContain('event: snapshot');
      expect(text).toContain('"slug":"public-demo"');
    } finally {
      client.close();
    }
  });

  it('streams incident events published through redis', async () => {
    const client = await openSse(port, slug);
    try {
      await client.waitFor((value) => value.includes('event: snapshot'));
      await events.publish(projectId, 'incident', {
        incidentId: '00000000-0000-0000-0000-000000000010',
        monitorId,
        status: 'investigating',
      });

      const text = await client.waitFor((value) => value.includes('event: incident'));
      expect(text).toContain('event: incident');
      expect(text).toContain('investigating');
      expect(text).toMatch(/id: \d+-0/);
    } finally {
      client.close();
    }
  });

  it('replays only events after Last-Event-ID on reconnect', async () => {
    const first = await events.publish(projectId, 'incident', {
      incidentId: '00000000-0000-0000-0000-000000000011',
      monitorId,
      status: 'identified',
    });
    await events.publish(projectId, 'incident', {
      incidentId: '00000000-0000-0000-0000-000000000012',
      monitorId,
      status: 'resolved',
    });

    const client = await openSse(port, slug, first.id);
    try {
      const text = await client.waitFor((value) => value.includes('event: incident'));
      expect(text).not.toContain('"status":"identified"');
      expect(text).toContain('"status":"resolved"');
    } finally {
      client.close();
    }
  });

  it('sends heartbeat comments', async () => {
    const client = await openSse(port, slug);
    try {
      const text = await client.waitFor((value) => value.includes(': ping'));
      expect(text).toContain(': ping');
    } finally {
      client.close();
    }
  });
});

describe('Public status rate limiting', () => {
  let app: INestApplication;
  let slug: string;

  beforeAll(async () => {
    app = await createTestApp();
    const server = app.getHttpServer() as Server;
    const token = (await registerUser(server, uniqueEmail('rate-limit'))).accessToken;
    const project = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rate Limited', public: true })
      .expect(201);
    slug = project.body.slug as string;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after 60 requests in a minute', async () => {
    const server = app.getHttpServer() as Server;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await request(server).get(`/v1/projects/${slug}/status`).expect(200);
    }
    await request(server).get(`/v1/projects/${slug}/status`).expect(429);
  });
});
