import { createApiClient } from '@statusbeam/contracts';

export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${apiBaseUrl}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) {
          accessToken = null;
          return null;
        }
        const body = (await response.json()) as { accessToken: string };
        accessToken = body.accessToken;
        return accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

const authenticatedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set('authorization', `Bearer ${accessToken}`);
  }

  const request = (): Promise<Response> =>
    fetch(input, {
      ...init,
      headers,
      credentials: 'include',
    });

  let response = await request();

  const url =
    input instanceof Request ? input.url : input instanceof URL ? input.toString() : input;
  if (response.status === 401 && !url.includes('/v1/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      headers.set('authorization', `Bearer ${refreshed}`);
      response = await request();
    }
  }

  return response;
};

export const api = createApiClient(apiBaseUrl, authenticatedFetch);
export { refreshAccessToken };
