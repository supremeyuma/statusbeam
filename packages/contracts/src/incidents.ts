import { z } from 'zod';

export const incidentStatusSchema = z.enum([
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]);

export const incidentUpdateInputSchema = z.object({
  status: incidentStatusSchema,
  message: z.string().trim().min(1).max(2000),
});

export const incidentResponseSchema = z.object({
  id: z.uuid(),
  monitorId: z.uuid(),
  status: incidentStatusSchema,
  startedAt: z.string(),
  resolvedAt: z.string().nullable(),
  cause: z.string().nullable(),
});

export const incidentUpdateResponseSchema = z.object({
  id: z.uuid(),
  incidentId: z.uuid(),
  status: incidentStatusSchema,
  message: z.string(),
  actor: z.string(),
  createdAt: z.string(),
});

export const incidentDetailResponseSchema = incidentResponseSchema.extend({
  updates: z.array(incidentUpdateResponseSchema),
});

export const incidentListResponseSchema = z.array(incidentResponseSchema);

export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type IncidentUpdateInput = z.infer<typeof incidentUpdateInputSchema>;
export type IncidentResponse = z.infer<typeof incidentResponseSchema>;
export type IncidentUpdateResponse = z.infer<typeof incidentUpdateResponseSchema>;
export type IncidentDetailResponse = z.infer<typeof incidentDetailResponseSchema>;
