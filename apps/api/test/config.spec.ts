import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../src/common/config';

const baseEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6380',
  JWT_SECRET: 'x'.repeat(32),
  JWT_REFRESH_SECRET: 'y'.repeat(32),
  ENCRYPTION_KEY: 'a'.repeat(64),
};

describe('loadConfig', () => {
  it('accepts a complete environment and applies defaults', () => {
    const config = loadConfig(baseEnv);
    expect(config.nodeEnv).toBe('test');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3001);
    expect(config.allowPrivateTargets).toBe(false);
    expect(config.checkTimeoutMs).toBe(5000);
    expect(config.logLevel).toBe('info');
  });

  it('rejects a missing database url', () => {
    const { DATABASE_URL, ...env } = baseEnv;
    void DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a short jwt secret', () => {
    expect(() => loadConfig({ ...baseEnv, JWT_SECRET: 'too-short' })).toThrow(
      /JWT_SECRET must be at least 32/,
    );
  });

  it('rejects a malformed encryption key', () => {
    expect(() => loadConfig({ ...baseEnv, ENCRYPTION_KEY: 'zz' })).toThrow(/ENCRYPTION_KEY/);
  });

  it('parses boolean and numeric flags', () => {
    const config = loadConfig({
      ...baseEnv,
      ALLOW_PRIVATE_TARGETS: 'true',
      CHECK_TIMEOUT_MS: '1500',
      PORT: '4000',
    });
    expect(config.allowPrivateTargets).toBe(true);
    expect(config.checkTimeoutMs).toBe(1500);
    expect(config.port).toBe(4000);
  });
});
