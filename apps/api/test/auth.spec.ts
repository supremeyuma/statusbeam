import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';

import { createTestApp, resetDatabase, TEST_PASSWORD, uniqueEmail } from './helpers/test-app';

function readRefreshCookie(headers: Record<string, unknown>): string | undefined {
  const setCookie = headers['set-cookie'];
  const list = Array.isArray(setCookie)
    ? setCookie
    : typeof setCookie === 'string'
      ? [setCookie]
      : [];
  const cookie = list.find((entry) => entry.startsWith('sb_refresh='));
  return cookie?.split(';')[0]?.split('=')[1];
}

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user, returns an access token, and sets a refresh cookie', async () => {
    const response = await request(server)
      .post('/v1/auth/register')
      .send({ email: 'owner@example.com', password: TEST_PASSWORD })
      .expect(201);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe('owner@example.com');
    expect(readRefreshCookie(response.headers)).toBeTruthy();
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects duplicate registration', async () => {
    await request(server)
      .post('/v1/auth/register')
      .send({ email: 'owner@example.com', password: TEST_PASSWORD })
      .expect(409);
  });

  it('rejects a short password with a 400 envelope', async () => {
    const response = await request(server)
      .post('/v1/auth/register')
      .send({ email: uniqueEmail('short'), password: 'short' })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body.message)).toContain('12');
  });

  it('logs in and rejects a wrong password', async () => {
    await request(server)
      .post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: TEST_PASSWORD })
      .expect(200);

    await request(server)
      .post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: 'wrong-password-123' })
      .expect(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const agent = request.agent(server);
    const login = await agent
      .post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: TEST_PASSWORD })
      .expect(200);
    const firstRefresh = readRefreshCookie(login.headers);
    expect(firstRefresh).toBeTruthy();

    const refreshed = await agent.post('/v1/auth/refresh').expect(200);
    const secondRefresh = readRefreshCookie(refreshed.headers);
    expect(secondRefresh).toBeTruthy();
    expect(secondRefresh).not.toBe(firstRefresh);

    // Reusing the rotated token must fail and revoke the whole family.
    await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', `sb_refresh=${firstRefresh}`)
      .expect(401);

    await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', `sb_refresh=${secondRefresh}`)
      .expect(401);
  });

  it('revokes the refresh token on logout', async () => {
    const agent = request.agent(server);
    const login = await agent
      .post('/v1/auth/login')
      .send({ email: 'owner@example.com', password: TEST_PASSWORD })
      .expect(200);
    const token = readRefreshCookie(login.headers);

    await agent.post('/v1/auth/logout').expect(204);
    await request(server).post('/v1/auth/refresh').set('Cookie', `sb_refresh=${token}`).expect(401);
  });

  it('rejects an expired access token', async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? '');
    const expired = await new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-000000000000')
      .setIssuer('statusbeam')
      .setAudience('statusbeam-api')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(secret);

    await request(server).get('/v1/projects').set('Authorization', `Bearer ${expired}`).expect(401);
  });
});

describe('Login rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 after five attempts in a minute', async () => {
    const server = app.getHttpServer() as Server;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'not-the-password' })
        .expect(401);
    }

    await request(server)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'not-the-password' })
      .expect(429);
  });
});
