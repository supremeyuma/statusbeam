import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { Queue } from 'bullmq';
import type { Server } from 'node:http';

import type { AppConfig } from '../src/common/config';
import { DATABASE } from '../src/db/database.module';
import type { Database } from '../src/db/client';
import { incidentUpdates, incidents, monitors } from '../src/db/schema';
import { EmailAdapter } from '../src/modules/notifications/adapters/email.adapter';
import { SlackAdapter } from '../src/modules/notifications/adapters/slack.adapter';
import { WebhookAdapter } from '../src/modules/notifications/adapters/webhook.adapter';
import type { NotificationEvent } from '../src/modules/notifications/adapters/types';
import {
  NOTIFICATIONS_QUEUE,
  NOTIFICATION_DLQ,
} from '../src/modules/notifications/notifications.tokens';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

type SinkMode = 'ok' | 'fail400' | 'fail500' | 'hang';

interface CapturedRequest {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function createSink() {
  let mode: SinkMode = 'ok';
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      if (mode === 'hang') {
        return;
      }
      if (mode === 'fail400') {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('bad request');
        return;
      }
      if (mode === 'fail500') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('server error');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });

  return {
    server,
    requests,
    setMode: (next: SinkMode) => {
      mode = next;
    },
    listen: async () => {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as AddressInfo;
      return `http://127.0.0.1:${address.port}`;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const event: NotificationEvent = {
  incidentId: '00000000-0000-0000-0000-000000000001',
  updateId: '00000000-0000-0000-0000-000000000002',
  status: 'investigating',
  message: 'Something broke',
  monitorId: '00000000-0000-0000-0000-000000000003',
  monitorName: 'API health',
  projectSlug: 'demo',
  cause: 'http_status: 500',
  occurredAt: new Date('2026-01-01T00:00:00Z').toISOString(),
};

async function waitFor<T>(
  probe: () => Promise<T | null | undefined>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null && value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for condition');
}

describe('Notification adapters', () => {
  it('signs and delivers webhook payloads, classifying 400 and 500', async () => {
    const sink = createSink();
    const url = await sink.listen();
    const adapter = new WebhookAdapter();
    const secret = 'super-secret-value';

    try {
      await expect(adapter.send({ url, secret }, event)).resolves.toEqual({ ok: true });

      const captured = sink.requests[0]!;
      const timestamp = Number(
        (captured.headers['x-statusbeam-signature'] as string).match(/t=(\d+)/)?.[1],
      );
      const expected = createHmac('sha256', secret)
        .update(`${timestamp}.${captured.body}`)
        .digest('hex');
      expect(captured.headers['x-statusbeam-signature']).toBe(`t=${timestamp},v1=${expected}`);

      sink.setMode('fail400');
      const permanent = await adapter.send({ url }, event);
      expect(permanent).toMatchObject({ ok: false, retryable: false, errorClass: 'http_400' });

      sink.setMode('fail500');
      const temporary = await adapter.send({ url }, event);
      expect(temporary).toMatchObject({ ok: false, retryable: true, errorClass: 'http_500' });
    } finally {
      await sink.close();
    }
  });

  it('times out a hanging webhook', async () => {
    const sink = createSink();
    const url = await sink.listen();
    sink.setMode('hang');
    try {
      const result = await new WebhookAdapter().send({ url }, event);
      expect(result).toMatchObject({ ok: false, retryable: true, errorClass: 'timeout' });
    } finally {
      await sink.close();
    }
  }, 20_000);

  it('sends slack blocks', async () => {
    const sink = createSink();
    const url = await sink.listen();
    try {
      await expect(new SlackAdapter().send({ webhookUrl: url }, event)).resolves.toEqual({
        ok: true,
      });
      const payload = JSON.parse(sink.requests[0]!.body) as { blocks: unknown[] };
      expect(payload.blocks).toHaveLength(3);
    } finally {
      await sink.close();
    }
  });

  it('skips email cleanly when no provider is configured', async () => {
    const adapter = new EmailAdapter({
      resendApiKey: undefined,
      smtpUrl: undefined,
      mailFrom: 'statusbeam@example.com',
    } as unknown as AppConfig);
    await expect(adapter.send({ to: 'ops@example.com' }, event)).resolves.toEqual({
      ok: true,
      skipped: true,
    });
  });
});

describe('Notification queue, DLQ, and replay', () => {
  let app: INestApplication;
  let db: Database;
  let server: Server;
  let sink: ReturnType<typeof createSink>;
  let sinkUrl: string;
  let notifications: NotificationsService;
  let queue: Queue;
  let dlq: Queue;
  let token: string;
  let userId: string;
  let projectId: string;
  let monitorId: string;
  let channelId: string;
  let incidentId: string;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'true';
    await resetDatabase();
    sink = createSink();
    sinkUrl = await sink.listen();
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
    notifications = app.get(NotificationsService);
    queue = app.get<Queue>(NOTIFICATIONS_QUEUE);
    dlq = app.get<Queue>(NOTIFICATION_DLQ);
    server = app.getHttpServer() as Server;

    const registered = await registerUser(server, uniqueEmail('notify-owner'));
    token = registered.accessToken;
    userId = registered.user.id;

    const project = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Notify Project' })
      .expect(201);
    projectId = project.body.id;

    const [monitor] = await db
      .insert(monitors)
      .values({
        projectId,
        name: 'notify target',
        type: 'http',
        config: {
          url: 'http://127.0.0.1:9',
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      })
      .returning();
    monitorId = monitor!.id;

    const channel = await request(server)
      .post('/v1/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId,
        type: 'webhook',
        config: { url: sinkUrl, secret: 'super-secret-value' },
      })
      .expect(201);
    channelId = channel.body.id;
    expect(channel.body.config.secret).toBeUndefined();

    const [incident] = await db
      .insert(incidents)
      .values({ monitorId, status: 'investigating', cause: 'seeded failure' })
      .returning();
    incidentId = incident!.id;
  });

  afterAll(async () => {
    await app.close();
    await sink.close();
    process.env.JOBS_ENABLED = 'false';
  });

  async function seedUpdate(message: string): Promise<typeof incidentUpdates.$inferSelect> {
    const [update] = await db
      .insert(incidentUpdates)
      .values({ incidentId, status: 'investigating', message, actor: 'system' })
      .returning();
    return update!;
  }

  it('dedupes enqueue by deterministic jobId and delivers once', async () => {
    sink.setMode('ok');
    const update = await seedUpdate('first delivery');
    const first = await notifications.enqueueForUpdate(update);
    const second = await notifications.enqueueForUpdate(update);

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    const job = await queue.getJob(first[0]!);
    expect(job).not.toBeNull();

    await waitFor(() => Promise.resolve(sink.requests.length > 0 ? true : null));
    expect(sink.requests.at(-1)!.body).toContain('first delivery');
  });

  it('moves a permanent failure to the DLQ and records it', async () => {
    sink.setMode('fail400');
    const update = await seedUpdate('permanent failure');
    await notifications.enqueueForUpdate(update);

    const failures = await waitFor(async () => {
      const list = await notifications.listFailures(userId);
      return list.length > 0 ? list : null;
    });

    expect(failures[0]!.errorClass).toBe('http_400');
    expect(failures[0]!.incidentUpdateId).toBe(update.id);
    const dlqJob = await dlq.getJob(`dlq:${failures[0]!.id}`);
    expect(dlqJob).not.toBeNull();

    const api = await request(server)
      .get('/v1/notifications/dlq')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(api.body).toHaveLength(1);
  });

  it('replays through the same jobId without duplicating deliveries', async () => {
    const failures = await notifications.listFailures(userId);
    const failure = failures[0]!;
    sink.setMode('ok');
    const before = sink.requests.length;

    const firstReplay = await notifications.replay(userId, failure.id);
    const secondReplay = await notifications.replay(userId, failure.id);
    expect(firstReplay.jobId).toBe(failure.jobId);
    expect(secondReplay.jobId).toBe(failure.jobId);

    await waitFor(() => Promise.resolve(sink.requests.length > before ? true : null));
    const afterReplay = sink.requests.length;

    await notifications.replay(userId, failure.id);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sink.requests.length).toBe(afterReplay);
  });

  it('enforces channel ownership and never returns webhook secrets', async () => {
    const other = (await registerUser(server, uniqueEmail('notify-other'))).accessToken;
    await request(server)
      .patch(`/v1/channels/${channelId}`)
      .set('Authorization', `Bearer ${other}`)
      .send({ active: false })
      .expect(404);

    const mine = await request(server)
      .get(`/v1/channels?projectId=${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].config.secret).toBeUndefined();
    expect(mine.body[0].config.url).toBe(sinkUrl);
  });
});
