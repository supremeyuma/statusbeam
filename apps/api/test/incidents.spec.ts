import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { DATABASE } from '../src/db/database.module';
import type { Database } from '../src/db/client';
import { checks, incidentUpdates, incidents, monitors, projects, users } from '../src/db/schema';
import { IncidentEvaluator } from '../src/modules/incidents/evaluator.service';
import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

describe('Incident evaluator hysteresis', () => {
  let app: INestApplication;
  let db: Database;
  let evaluator: IncidentEvaluator;
  let monitorId: string;
  let clock = new Date('2026-03-01T10:00:00.000Z');

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    db = app.get<Database>(DATABASE);
    evaluator = app.get(IncidentEvaluator);

    const [user] = await db
      .insert(users)
      .values({ email: 'evaluator@example.com', passwordHash: 'x' })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ userId: user!.id, name: 'Evaluator', slug: 'evaluator' })
      .returning();
    const [monitor] = await db
      .insert(monitors)
      .values({
        projectId: project!.id,
        name: 'flapping target',
        type: 'http',
        config: {
          url: 'http://127.0.0.1:9',
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
        retries: 3,
      })
      .returning();
    monitorId = monitor!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    clock = new Date(clock.getTime() + 60 * 60 * 1000);
  });

  async function addCheck(status: 'up' | 'down'): Promise<void> {
    clock = new Date(clock.getTime() + 1000);
    await db.insert(checks).values({
      monitorId,
      status,
      latencyMs: 12,
      error: status === 'down' ? 'http_status: unexpected status 500' : null,
      checkedAt: clock,
    });
  }

  async function evaluateAfter(status: 'up' | 'down'): Promise<void> {
    await addCheck(status);
    await evaluator.evaluate(monitorId);
  }

  it('does not open an incident for a flapping monitor with retries=3', async () => {
    for (const status of ['down', 'down', 'up', 'down', 'down', 'up'] as const) {
      await evaluateAfter(status);
    }

    const rows = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(rows).toHaveLength(0);
  });

  it('opens exactly one incident after three consecutive failures', async () => {
    await evaluateAfter('down');
    await evaluateAfter('down');
    await evaluateAfter('down');

    const rows = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('investigating');
    expect(rows[0]!.cause).toContain('http_status');

    await evaluateAfter('down');
    const stillOne = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(stillOne).toHaveLength(1);
  });

  it('resolves after two consecutive successes and appends a system update', async () => {
    await evaluateAfter('up');
    await evaluateAfter('up');

    const rows = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('resolved');
    expect(rows[0]!.resolvedAt).not.toBeNull();

    const updates = await db
      .select()
      .from(incidentUpdates)
      .where(eq(incidentUpdates.incidentId, rows[0]!.id))
      .orderBy(incidentUpdates.createdAt);
    expect(updates.map((update) => update.status)).toEqual(['investigating', 'resolved']);
    expect(updates[1]!.actor).toBe('system');

    await evaluateAfter('up');
    const after = await db.select().from(incidents).where(eq(incidents.monitorId, monitorId));
    expect(after).toHaveLength(1);
  });
});

describe('Incident update API transitions', () => {
  let app: INestApplication;
  let server: Server;
  let db: Database;
  let token: string;
  let incidentId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    db = app.get<Database>(DATABASE);
    token = (await registerUser(server, uniqueEmail('incident-owner'))).accessToken;

    const user = await db.select().from(users).limit(1);
    const [project] = await db
      .insert(projects)
      .values({ userId: user[0]!.id, name: 'Incident API', slug: 'incident-api' })
      .returning();
    const [monitor] = await db
      .insert(monitors)
      .values({
        projectId: project!.id,
        name: 'api target',
        type: 'http',
        config: {
          url: 'http://127.0.0.1:9',
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      })
      .returning();
    const [incident] = await db
      .insert(incidents)
      .values({ monitorId: monitor!.id, status: 'investigating', cause: 'seeded' })
      .returning();
    incidentId = incident!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('walks valid transitions and rejects invalid ones with allowed transitions', async () => {
    await request(server)
      .post(`/v1/incidents/${incidentId}/updates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'identified', message: 'Looking into it' })
      .expect(201);

    const invalid = await request(server)
      .post(`/v1/incidents/${incidentId}/updates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'investigating', message: 'Backwards' })
      .expect(409);
    expect(invalid.body.allowedTransitions).toEqual(['monitoring', 'resolved']);

    await request(server)
      .post(`/v1/incidents/${incidentId}/updates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'monitoring', message: 'Fix deployed' })
      .expect(201);

    await request(server)
      .post(`/v1/incidents/${incidentId}/updates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'resolved', message: 'Recovered' })
      .expect(201);

    await request(server)
      .post(`/v1/incidents/${incidentId}/updates`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'investigating', message: 'Reopen' })
      .expect(409);

    const detail = await request(server)
      .get(`/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(detail.body.status).toBe('resolved');
    expect(detail.body.updates).toHaveLength(3);
    expect(detail.body.updates[0].actor).toContain('user:');
  });

  it('hides incidents from other users', async () => {
    const other = (await registerUser(server, uniqueEmail('incident-other'))).accessToken;
    await request(server)
      .get(`/v1/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${other}`)
      .expect(404);
  });
});
