import type { PublicStatusResponse } from '@statusbeam/contracts';

export const apiBaseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
export const publicApiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchPublicStatus(slug: string): Promise<PublicStatusResponse | null> {
  const response = await fetch(`${apiBaseUrl}/v1/projects/${encodeURIComponent(slug)}/status`, {
    cache: 'no-store',
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`status API returned ${response.status}`);
  }

  return (await response.json()) as PublicStatusResponse;
}

export function streamUrl(slug: string): string {
  return `${publicApiBaseUrl}/v1/projects/${encodeURIComponent(slug)}/stream`;
}
