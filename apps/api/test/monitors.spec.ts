import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

interface ProjectFixture {
  id: string;
  slug: string;
}

async function createProject(server: Server, token: string, name: string): Promise<ProjectFixture> {
  const response = await request(server)
    .post('/v1/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name })
    .expect(201);
  return response.body as ProjectFixture;
}

function monitorPayload(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    name: 'API health',
    type: 'http',
    config: { url: 'http://127.0.0.1:9099/health', expectedStatus: [200] },
    intervalS: 60,
    timeoutMs: 2000,
    retries: 2,
    ...overrides,
  };
}

describe('Monitors (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let project: ProjectFixture;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    token = (await registerUser(server, uniqueEmail('monitor-owner'))).accessToken;
    project = await createProject(server, token, 'Monitor Project');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an HTTP monitor with nextRunAt', async () => {
    const response = await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send(monitorPayload(project.id))
      .expect(201);

    expect(response.body.type).toBe('http');
    expect(response.body.nextRunAt).toEqual(expect.any(String));
    expect(response.body.lastStatus).toBeNull();
  });

  it('creates a TCP monitor', async () => {
    const response = await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: project.id,
        name: 'Postgres port',
        type: 'tcp',
        config: { host: '127.0.0.1', port: 5433 },
        intervalS: 120,
      })
      .expect(201);

    expect(response.body.config).toEqual({ host: '127.0.0.1', port: 5433 });
  });

  it.each([
    ['bad protocol', monitorPayload('', { config: { url: 'ftp://example.com' } })],
    ['bad url', monitorPayload('', { config: { url: 'not-a-url' } })],
    ['credentials in url', monitorPayload('', { config: { url: 'http://u:p@example.com' } })],
    ['bad regex', monitorPayload('', { config: { url: 'http://127.0.0.1:9099', bodyRegex: '(' } })],
    ['interval too small', monitorPayload('', { intervalS: 29 })],
    ['interval too large', monitorPayload('', { intervalS: 3601 })],
    ['timeout too small', monitorPayload('', { timeoutMs: 999 })],
    ['retries too large', monitorPayload('', { retries: 11 })],
    [
      'tcp port zero',
      { projectId: '', name: 'tcp', type: 'tcp', config: { host: '127.0.0.1', port: 0 } },
    ],
  ])('rejects %s', async (_label, payload) => {
    const body = { ...payload, projectId: project.id };
    await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
  });

  it('rejects a project the caller does not own', async () => {
    const stranger = (await registerUser(server, uniqueEmail('stranger'))).accessToken;
    await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${stranger}`)
      .send(monitorPayload(project.id))
      .expect(404);
  });

  it('updates fields and keeps the type immutable', async () => {
    const created = await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send(monitorPayload(project.id, { name: 'Editable' }))
      .expect(201);

    const updated = await request(server)
      .patch(`/v1/monitors/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ intervalS: 120, name: 'Renamed' })
      .expect(200);
    expect(updated.body.intervalS).toBe(120);
    expect(updated.body.name).toBe('Renamed');

    await request(server)
      .patch(`/v1/monitors/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { type: 'tcp', config: { host: '127.0.0.1', port: 1234 } } })
      .expect(400);
  });

  it('deletes a monitor', async () => {
    const created = await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send(monitorPayload(project.id, { name: 'Temporary' }))
      .expect(201);

    await request(server)
      .delete(`/v1/monitors/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(server)
      .get(`/v1/monitors/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});

describe('Monitors reject SSRF targets when private targets are disabled (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let project: ProjectFixture;
  const previous = process.env.ALLOW_PRIVATE_TARGETS;

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_TARGETS = 'false';
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    token = (await registerUser(server, uniqueEmail('ssrf-owner'))).accessToken;
    project = await createProject(server, token, 'SSRF Project');
  });

  afterAll(async () => {
    await app.close();
    process.env.ALLOW_PRIVATE_TARGETS = previous;
  });

  it('rejects a loopback HTTP target', async () => {
    const response = await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send(monitorPayload(project.id))
      .expect(400);
    expect(JSON.stringify(response.body.message)).toContain('private');
  });

  it('rejects a loopback TCP target', async () => {
    await request(server)
      .post('/v1/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        projectId: project.id,
        name: 'loopback tcp',
        type: 'tcp',
        config: { host: '127.0.0.1', port: 5432 },
      })
      .expect(400);
  });
});
