import { z } from 'zod';

/**
 * Zod 4 can emit JSON Schema directly, which keeps request/response documentation in sync
 * with the runtime validation instead of maintaining DTO classes twice.
 */
export function requestSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
    unrepresentable: 'any',
  });
}

export function responseSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    io: 'output',
    target: 'draft-7',
    unrepresentable: 'any',
  });
}
