import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

describe('API keys (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let token: string;
  let projectId: string;
  let readKey: string;
  let readKeyId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    token = (await registerUser(server, uniqueEmail('key-owner'))).accessToken;

    const project = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'API Key Project' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a key and returns the secret exactly once', async () => {
    const response = await request(server)
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, name: 'read only', scopes: ['monitors:read'] })
      .expect(201);

    expect(response.body.key).toMatch(/^sb_live_/);
    expect(response.body.prefix).toMatch(/^sb_live_/);
    readKey = response.body.key as string;
    readKeyId = response.body.id as string;

    const list = await request(server)
      .get(`/v1/api-keys?projectId=${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body[0].key).toBeUndefined();
  });

  it('authenticates with an API key for its scoped project', async () => {
    const response = await request(server)
      .get(`/v1/monitors?projectId=${projectId}`)
      .set('X-API-Key', readKey)
      .expect(200);
    expect(response.body).toEqual([]);
  });

  it('rejects a write with a read-only key', async () => {
    const response = await request(server)
      .post('/v1/monitors')
      .set('X-API-Key', readKey)
      .send({
        projectId,
        name: 'blocked',
        type: 'http',
        config: { url: 'http://127.0.0.1:9099/health' },
      })
      .expect(403);
    expect(JSON.stringify(response.body.message)).toContain('monitors:write');
  });

  it('allows writes with a monitors:write key', async () => {
    const created = await request(server)
      .post('/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ projectId, name: 'writer', scopes: ['monitors:read', 'monitors:write'] })
      .expect(201);

    await request(server)
      .post('/v1/monitors')
      .set('X-API-Key', created.body.key as string)
      .send({
        projectId,
        name: 'via key',
        type: 'http',
        config: { url: 'http://127.0.0.1:9099/health' },
      })
      .expect(201);
  });

  it('refuses project management with an API key', async () => {
    await request(server)
      .post('/v1/projects')
      .set('X-API-Key', readKey)
      .send({ name: 'nope' })
      .expect(403);
  });

  it('rejects a revoked key', async () => {
    await request(server)
      .delete(`/v1/api-keys/${readKeyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(server)
      .get(`/v1/monitors?projectId=${projectId}`)
      .set('X-API-Key', readKey)
      .expect(401);
  });
});
