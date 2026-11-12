import { z } from 'zod';

/**
 * Environment contract for the API. Validated once at boot so a missing or weak secret
 * fails fast with a readable message instead of a confusing runtime error later.
 */
const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters'),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().optional(),
  ),
  SLACK_WEBHOOK_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  MAIL_FROM: z.string().email().default('statusbeam@example.com'),
  ALLOW_PRIVATE_TARGETS: booleanFromString,
  CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5000),
  CHECK_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  ROLLUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  isProduction: boolean;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
  resendApiKey: string | undefined;
  slackWebhookUrl: string | undefined;
  mailFrom: string;
  allowPrivateTargets: boolean;
  checkTimeoutMs: number;
  checkRetentionDays: number;
  rollupRetentionDays: number;
  jobsEnabled: boolean;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

export class ConfigError extends Error {
  public override readonly name = 'ConfigError';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }

  const value = parsed.data;

  return {
    nodeEnv: value.NODE_ENV,
    isProduction: value.NODE_ENV === 'production',
    port: value.PORT,
    publicBaseUrl: value.PUBLIC_BASE_URL,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    jwtSecret: value.JWT_SECRET,
    jwtRefreshSecret: value.JWT_REFRESH_SECRET,
    encryptionKey: value.ENCRYPTION_KEY,
    resendApiKey: value.RESEND_API_KEY,
    slackWebhookUrl: value.SLACK_WEBHOOK_URL,
    mailFrom: value.MAIL_FROM,
    allowPrivateTargets: value.ALLOW_PRIVATE_TARGETS,
    checkTimeoutMs: value.CHECK_TIMEOUT_MS,
    checkRetentionDays: value.CHECK_RETENTION_DAYS,
    rollupRetentionDays: value.ROLLUP_RETENTION_DAYS,
    jobsEnabled: value.JOBS_ENABLED,
    logLevel: value.LOG_LEVEL,
  };
}
