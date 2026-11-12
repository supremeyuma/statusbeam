import { z } from 'zod';

export const checkRecordSchema = z.object({
  id: z.number(),
  monitorId: z.uuid(),
  region: z.string(),
  status: z.enum(['up', 'down']),
  latencyMs: z.number(),
  statusCode: z.number().nullable(),
  error: z.string().nullable(),
  checkedAt: z.string(),
});

export const checkListResponseSchema = z.object({
  items: z.array(checkRecordSchema),
  nextCursor: z.string().nullable(),
});

export type CheckRecord = z.infer<typeof checkRecordSchema>;
export type CheckListResponse = z.infer<typeof checkListResponseSchema>;
