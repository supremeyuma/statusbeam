import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const monitorTypeEnum = pgEnum('monitor_type', ['http', 'tcp']);
export const checkStatusEnum = pgEnum('check_status', ['up', 'down']);
export const incidentStatusEnum = pgEnum('incident_status', [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);
export const channelTypeEnum = pgEnum('channel_type', ['webhook', 'slack', 'email']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt,
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    public: boolean('public').notNull().default(false),
    createdAt,
  },
  (table) => [
    uniqueIndex('projects_slug_key').on(table.slug),
    index('projects_user_id_idx').on(table.userId),
  ],
);

export const monitors = pgTable(
  'monitors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: monitorTypeEnum('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    intervalS: integer('interval_s').notNull().default(60),
    timeoutMs: integer('timeout_ms').notNull().default(5000),
    retries: integer('retries').notNull().default(3),
    active: boolean('active').notNull().default(true),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastStatus: checkStatusEnum('last_status'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('monitors_project_active_idx').on(table.projectId, table.active),
    index('monitors_next_run_at_idx').on(table.nextRunAt),
  ],
);

export const checks = pgTable(
  'checks',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    region: text('region').notNull().default('local'),
    status: checkStatusEnum('status').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    statusCode: integer('status_code'),
    error: text('error'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('checks_monitor_checked_at_idx').on(table.monitorId, table.checkedAt.desc()),
    index('checks_checked_at_idx').on(table.checkedAt),
  ],
);

export const rollups = pgTable(
  'rollups',
  {
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    bucketHour: timestamp('bucket_hour', { withTimezone: true }).notNull(),
    upCount: integer('up_count').notNull().default(0),
    downCount: integer('down_count').notNull().default(0),
    p95LatencyMs: integer('p95_latency_ms'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.monitorId, table.bucketHour] })],
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    monitorId: uuid('monitor_id')
      .notNull()
      .references(() => monitors.id, { onDelete: 'cascade' }),
    status: incidentStatusEnum('status').notNull().default('investigating'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    cause: text('cause'),
    createdAt,
  },
  (table) => [
    index('incidents_monitor_started_at_idx').on(table.monitorId, table.startedAt.desc()),
    index('incidents_open_idx')
      .on(table.monitorId)
      .where(sql`${table.resolvedAt} IS NULL`),
  ],
);

export const incidentUpdates = pgTable(
  'incident_updates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    status: incidentStatusEnum('status').notNull(),
    message: text('message').notNull(),
    actor: text('actor').notNull().default('system'),
    createdAt,
  },
  (table) => [index('incident_updates_incident_created_idx').on(table.incidentId, table.createdAt)],
);

export const channels = pgTable(
  'channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: channelTypeEnum('type').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    active: boolean('active').notNull().default(true),
    createdAt,
  },
  (table) => [index('channels_project_id_idx').on(table.projectId)],
);

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    prefix: text('prefix').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('api_keys_key_hash_key').on(table.keyHash),
    index('api_keys_project_id_idx').on(table.projectId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex('refresh_tokens_token_hash_key').on(table.tokenHash),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_id_idx').on(table.familyId),
  ],
);

export const notificationFailures = pgTable(
  'notification_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: text('job_id').notNull(),
    channelId: uuid('channel_id'),
    incidentUpdateId: uuid('incident_update_id'),
    errorClass: text('error_class').notNull(),
    message: text('message').notNull(),
    attempts: integer('attempts').notNull().default(0),
    createdAt,
  },
  (table) => [index('notification_failures_created_idx').on(table.createdAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Monitor = typeof monitors.$inferSelect;
export type NewMonitor = typeof monitors.$inferInsert;
export type Check = typeof checks.$inferSelect;
export type NewCheck = typeof checks.$inferInsert;
export type Rollup = typeof rollups.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type IncidentUpdate = typeof incidentUpdates.$inferSelect;
export type NewIncidentUpdate = typeof incidentUpdates.$inferInsert;
export type Channel = typeof channels.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type MonitorType = (typeof monitorTypeEnum.enumValues)[number];
export type CheckStatus = (typeof checkStatusEnum.enumValues)[number];
export type IncidentStatus = (typeof incidentStatusEnum.enumValues)[number];
export type ChannelType = (typeof channelTypeEnum.enumValues)[number];
