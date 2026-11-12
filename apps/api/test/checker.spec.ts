import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AppConfig } from '../src/common/config';
import type { Monitor } from '../src/db/schema';
import { CheckerService } from '../src/modules/checks/checker.service';
import { startTargetServer, type TargetServer } from './fixtures/target-server';

const config = {
  allowPrivateTargets: true,
  checkTimeoutMs: 2000,
} as AppConfig;

function makeMonitor(overrides: Partial<Monitor> & Pick<Monitor, 'type' | 'config'>): Monitor {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    projectId: '00000000-0000-0000-0000-000000000002',
    name: 'fixture',
    intervalS: 60,
    timeoutMs: 2000,
    retries: 3,
    active: true,
    nextRunAt: null,
    lastStatus: null,
    lastCheckedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CheckerService HTTP', () => {
  let target: TargetServer;
  let checker: CheckerService;

  beforeAll(async () => {
    target = await startTargetServer();
    checker = new CheckerService(config);
  });

  afterAll(async () => {
    await target.close();
  });

  it('reports up with latency and status code', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/ok`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.statusCode).toBe(200);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.bodySnippet).toContain('healthy');
    }
  });

  it('flags an unexpected status', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/fail`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe('http_status');
      expect(result.statusCode).toBe(500);
    }
  });

  it('flags a body mismatch', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/ok`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
          bodyContains: 'not-there',
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe('body_mismatch');
    }
  });

  it('matches a body regex', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/json`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
          bodyRegex: '"status":"healthy"',
        },
      }),
    );

    expect(result.ok).toBe(true);
  });

  it('times out a slow target', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        timeoutMs: 100,
        config: {
          url: `${target.url}/slow`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe('timeout');
    }
  });

  it('flags latency above the threshold', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/slow`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
          latencyThresholdMs: 50,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe('latency_exceeded');
    }
  });

  it('classifies DNS failures', async () => {
    const result = await checker.check(
      makeMonitor({
        type: 'http',
        config: {
          url: 'http://definitely-not-real.invalid/health',
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorClass).toBe('dns');
    }
  });

  it('refuses loopback targets when private targets are disabled', async () => {
    const guarded = new CheckerService({ ...config, allowPrivateTargets: false });
    const result = await guarded.check(
      makeMonitor({
        type: 'http',
        config: {
          url: `${target.url}/ok`,
          method: 'GET',
          expectedStatus: [200],
          followRedirects: false,
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('private');
    }
  });
});

describe('CheckerService TCP', () => {
  let server: ReturnType<typeof createServer>;
  let port: number;
  let checker: CheckerService;

  beforeAll(async () => {
    checker = new CheckerService(config);
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connects to an open port', async () => {
    const result = await checker.check(
      makeMonitor({ type: 'tcp', config: { host: '127.0.0.1', port } }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('classifies a refused connection', async () => {
    const result = await checker.check(
      makeMonitor({ type: 'tcp', config: { host: '127.0.0.1', port: 1 } }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['connection_refused', 'unknown']).toContain(result.errorClass);
    }
  });
});
