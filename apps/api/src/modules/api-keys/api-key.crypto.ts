import { createHash, randomBytes } from 'node:crypto';

export const API_KEY_PREFIX = 'sb_live_';
export const API_KEY_BYTES = 32;

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(API_KEY_BYTES).toString('base64url')}`;
  return {
    key,
    prefix: key.slice(0, API_KEY_PREFIX.length + 8),
    hash: hashApiKey(key),
  };
}
