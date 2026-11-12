import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads the repository .env for local dev and CLI scripts. Existing variables win, so
 * compose, CI, and tests can inject their own values without being overridden.
 */
export function loadEnvFiles(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const path of candidates) {
    config({ path, override: false, quiet: true });
  }
}
