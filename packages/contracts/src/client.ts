import createClient from 'openapi-fetch';

import type { paths } from './openapi';

export type ApiPaths = paths;

/**
 * Typed fetch client generated from the API's OpenAPI document. All web calls go through
 * this so a renamed field or route is a compile error, not a runtime surprise.
 */
export function createApiClient(baseUrl: string, fetchImpl?: typeof fetch) {
  return createClient<paths>({
    baseUrl,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;
