import { z } from 'zod';
import { incidentStatusSchema } from './incidents';

export const publicMonitorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.enum(['http', 'tcp']),
  status: z.enum(['up', 'down', 'unknown']),
  lastCheckedAt: z.string().nullable(),
  uptime90d: z.number().nullable(),
  days: z.array(
    z.object({
      date: z.string(),
      uptimePct: z.number().nullable(),
    }),
  ),
});

export const publicIncidentSchema = z.object({
  id: z.uuid(),
  monitorId: z.uuid(),
  monitorName: z.string(),
  status: incidentStatusSchema,
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  cause: z.string().nullable(),
});

export const publicStatusResponseSchema = z.object({
  project: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  overallStatus: z.enum(['up', 'degraded', 'down']),
  updatedAt: z.string(),
  monitors: z.array(publicMonitorSchema),
  incidents: z.array(publicIncidentSchema),
});

export type PublicMonitor = z.infer<typeof publicMonitorSchema>;
export type PublicIncident = z.infer<typeof publicIncidentSchema>;
export type PublicStatusResponse = z.infer<typeof publicStatusResponseSchema>;
