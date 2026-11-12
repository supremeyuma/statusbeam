/**
 * Shared API contracts for StatusBeam.
 *
 * Runtime zod schemas and the generated OpenAPI types live here. The web app imports
 * from this package so request/response shapes can never drift from the API.
 */
export const CONTRACTS_VERSION = '0.0.0';

export interface HealthStatus {
  status: 'ok';
}
