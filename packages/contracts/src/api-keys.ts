import { z } from 'zod';

export const API_SCOPES = [
  'monitors:read',
  'monitors:write',
  'incidents:write',
  'status:read',
] as const;

export const apiScopeSchema = z.enum(API_SCOPES);
export const apiScopesSchema = z.array(apiScopeSchema).min(1);

export const createApiKeyInputSchema = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(1).max(80),
  scopes: apiScopesSchema,
});

export const apiKeyResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  prefix: z.string(),
  scopes: apiScopesSchema,
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
  key: z.string().optional(),
});

export const apiKeyListResponseSchema = z.array(apiKeyResponseSchema);

export type ApiScope = z.infer<typeof apiScopeSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeyInputSchema>;
export type ApiKeyResponse = z.infer<typeof apiKeyResponseSchema>;
