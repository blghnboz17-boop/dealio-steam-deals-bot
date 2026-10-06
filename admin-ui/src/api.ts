/** JSON calls to the bot's admin API. The session cookie is HttpOnly; POSTs carry the CSRF token. */

export class ApiError extends Error {
  public constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

let csrfToken: string | null = null;
let onSignedOut: () => void = () => undefined;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function whenSignedOut(callback: () => void): void {
  onSignedOut = callback;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') onSignedOut();
    throw new ApiError(response.status, payload?.error ?? `HTTP ${response.status}`);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>('GET', path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>('POST', path, body ?? {}),
};
