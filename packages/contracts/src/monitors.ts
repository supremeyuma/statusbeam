import { z } from 'zod';

export const monitorTypeSchema = z.enum(['http', 'tcp']);
export const checkStatusSchema = z.enum(['up', 'down']);

export const httpMonitorConfigSchema = z.object({
  url: z.string().url().max(2048),
  method: z.enum(['GET', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  expectedStatus: z.array(z.number().int().min(100).max(599)).min(1).default([200]),
  bodyContains: z.string().min(1).max(2000).optional(),
  bodyRegex: z.string().min(1).max(2000).optional(),
  latencyThresholdMs: z.number().int().min(1).max(60_000).optional(),
  followRedirects: z.boolean().default(false),
});

export const tcpMonitorConfigSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65_535),
});

const monitorBase = {
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  intervalS: z.number().int().min(30).max(3600).default(60),
  timeoutMs: z.number().int().min(1000).max(30_000).default(5000),
  retries: z.number().int().min(1).max(10).default(3),
  active: z.boolean().default(true),
};

export const httpMonitorInputSchema = z.object({
  ...monitorBase,
  type: z.literal('http'),
  config: httpMonitorConfigSchema,
});

export const tcpMonitorInputSchema = z.object({
  ...monitorBase,
  type: z.literal('tcp'),
  config: tcpMonitorConfigSchema,
});

export const monitorInputSchema = z.discriminatedUnion('type', [
  httpMonitorInputSchema,
  tcpMonitorInputSchema,
]);

const httpMonitorUpdateConfigSchema = z.object({
  type: z.literal('http'),
  config: httpMonitorConfigSchema,
});

const tcpMonitorUpdateConfigSchema = z.object({
  type: z.literal('tcp'),
  config: tcpMonitorConfigSchema,
});

export const monitorUpdateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    intervalS: z.number().int().min(30).max(3600).optional(),
    timeoutMs: z.number().int().min(1000).max(30_000).optional(),
    retries: z.number().int().min(1).max(10).optional(),
    active: z.boolean().optional(),
    config: z
      .discriminatedUnion('type', [httpMonitorUpdateConfigSchema, tcpMonitorUpdateConfigSchema])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field is required',
  });

export const monitorResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  type: monitorTypeSchema,
  config: z.record(z.string(), z.unknown()),
  intervalS: z.number(),
  timeoutMs: z.number(),
  retries: z.number(),
  active: z.boolean(),
  nextRunAt: z.string().nullable(),
  lastStatus: checkStatusSchema.nullable(),
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const monitorListResponseSchema = z.array(monitorResponseSchema);

export type MonitorType = z.infer<typeof monitorTypeSchema>;
export type CheckStatus = z.infer<typeof checkStatusSchema>;
export type HttpMonitorConfig = z.infer<typeof httpMonitorConfigSchema>;
export type TcpMonitorConfig = z.infer<typeof tcpMonitorConfigSchema>;
export type MonitorInput = z.infer<typeof monitorInputSchema>;
export type MonitorUpdateInput = z.infer<typeof monitorUpdateInputSchema>;
export type MonitorResponse = z.infer<typeof monitorResponseSchema>;
