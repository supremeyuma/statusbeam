import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { createTestApp, registerUser, resetDatabase, uniqueEmail } from './helpers/test-app';

describe('Projects (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let ownerToken: string;
  let otherToken: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
    ownerToken = (await registerUser(server, uniqueEmail('owner'))).accessToken;
    otherToken = (await registerUser(server, uniqueEmail('other'))).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a project with a slug derived from its name', async () => {
    const response = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Demo Status Page', public: true })
      .expect(201);

    expect(response.body.slug).toBe('demo-status-page');
    expect(response.body.public).toBe(true);
  });

  it('allocates a unique slug for a duplicate name', async () => {
    const response = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Demo Status Page' })
      .expect(201);

    expect(response.body.slug).toBe('demo-status-page-2');
  });

  it('lists only the caller projects', async () => {
    const mine = await request(server)
      .get('/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(mine.body).toHaveLength(2);

    const theirs = await request(server)
      .get('/v1/projects')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);
    expect(theirs.body).toHaveLength(0);
  });

  it('hides another user project behind a 404', async () => {
    const created = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Private Project' })
      .expect(201);

    await request(server)
      .get(`/v1/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('allows slug edits before publish and rejects them after', async () => {
    const created = await request(server)
      .post('/v1/projects')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Editable Slug' })
      .expect(201);

    const updated = await request(server)
      .patch(`/v1/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ slug: 'custom-slug' })
      .expect(200);
    expect(updated.body.slug).toBe('custom-slug');

    await request(server)
      .patch(`/v1/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ public: true })
      .expect(200);

    await request(server)
      .patch(`/v1/projects/${created.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ slug: 'too-late' })
      .expect(400);
  });
});
