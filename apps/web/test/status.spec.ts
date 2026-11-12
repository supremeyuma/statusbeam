import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import type { AddressInfo } from 'node:net';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';
const PASSWORD = 'playwright-password-123';

interface Fixture {
  token: string;
  projectId: string;
  projectSlug: string;
  monitorId: string;
  closeTarget: () => Promise<void>;
  setTargetMode: (mode: 'ok' | 'fail') => void;
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('timed out waiting for API condition');
}

test.describe('public status page live updates', () => {
  let fixture: Fixture;

  test.beforeAll(async () => {
    let mode: 'ok' | 'fail' = 'ok';
    const server = createServer((request, response) => {
      if (mode === 'fail') {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end('broken');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(`healthy ${request.url ?? ''}`);
    });
    await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
    const port = (server.address() as AddressInfo).port;
    const targetUrl = `http://host.docker.internal:${port}/health`;

    const email = `pw-${Date.now()}@example.com`;
    const registered = await fetch(`${API_URL}/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(registered.status).toBe(201);
    const auth = (await registered.json()) as { accessToken: string };

    const projectResponse = await fetch(`${API_URL}/v1/projects`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: `Playwright ${Date.now()}`, public: true }),
    });
    expect(projectResponse.status).toBe(201);
    const project = (await projectResponse.json()) as { id: string; slug: string };

    const monitorResponse = await fetch(`${API_URL}/v1/monitors`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        projectId: project.id,
        name: 'E2E target',
        type: 'http',
        intervalS: 30,
        timeoutMs: 5000,
        retries: 2,
        config: { url: targetUrl, expectedStatus: [200] },
      }),
    });
    expect(monitorResponse.status).toBe(201);
    const monitor = (await monitorResponse.json()) as { id: string };

    fixture = {
      token: auth.accessToken,
      projectId: project.id,
      projectSlug: project.slug,
      monitorId: monitor.id,
      closeTarget: () => new Promise<void>((resolve) => server.close(() => resolve())),
      setTargetMode: (next) => {
        mode = next;
      },
    };
  });

  test.afterAll(async () => {
    if (!fixture) {
      return;
    }
    await fetch(`${API_URL}/v1/monitors/${fixture.monitorId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${fixture.token}` },
    });
    await fixture.closeTarget();
  });

  test('monitor goes down and the page flips live, then recovers', async ({ page }) => {
    const headers = { authorization: `Bearer ${fixture.token}` };

    await waitFor(async () => {
      const response = await fetch(`${API_URL}/v1/monitors/${fixture.monitorId}`, {
        headers,
      });
      const monitor = (await response.json()) as { lastStatus: string | null };
      return monitor.lastStatus === 'up' ? monitor : null;
    }, 90_000);

    await page.goto(`/${fixture.projectSlug}`);
    await expect(page.getByText('All systems operational')).toBeVisible();
    await expect(page.getByText('E2E target')).toBeVisible();
    await expect(page.locator('[role="img"]').first().locator('span')).toHaveCount(90);

    fixture.setTargetMode('fail');

    await waitFor(async () => {
      const response = await fetch(`${API_URL}/v1/projects/${fixture.projectId}/incidents`, {
        headers,
      });
      const incidents = (await response.json()) as Array<{ resolvedAt: string | null }>;
      return incidents.some((incident) => incident.resolvedAt === null) ? incidents : null;
    }, 150_000);

    const banner = page.getByText('Major outage');
    const detectedAt = Date.now();
    await expect(banner).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - detectedAt).toBeLessThan(10_000);
    await expect(page.getByText(/active incident/)).toBeVisible();

    fixture.setTargetMode('ok');

    await waitFor(async () => {
      const response = await fetch(`${API_URL}/v1/projects/${fixture.projectId}/incidents`, {
        headers,
      });
      const incidents = (await response.json()) as Array<{ resolvedAt: string | null }>;
      return incidents.length > 0 && incidents.every((incident) => incident.resolvedAt !== null)
        ? incidents
        : null;
    }, 150_000);

    await expect(page.getByText('All systems operational')).toBeVisible({ timeout: 15_000 });
  });
});
