import { z } from 'zod';

export const errorEnvelopeSchema = z.object({
  statusCode: z.number(),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string(),
  requestId: z.string(),
  path: z.string(),
  timestamp: z.string(),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({
    database: z.enum(['up', 'down']),
    redis: z.enum(['up', 'down']),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
