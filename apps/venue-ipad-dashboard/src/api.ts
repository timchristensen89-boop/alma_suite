// Thin fetch wrapper for the venue iPad ops console.
//
// Matches the home-web pattern: relative paths via the Vite `/api` proxy in
// dev (forwarded to apps/api on :3018) and same-origin in production. Cookies
// are sent on every request so the venue device session + staff PIN session
// follow the user without manual token handling.

function normalisePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

export class ApiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export function messageForError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status >= 500) return fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(normalisePath(path), {
    credentials: 'include',
    ...init,
    headers
  });

  if (!response.ok) {
    let message = response.statusText || 'Request failed';
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
      if (typeof data?.error === 'string') message = data.error;
    } catch {
      // Keep the HTTP status text if the API did not return JSON.
    }
    throw new ApiRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

// ── Cross-app session handoff ────────────────────────────────────────────
// Mint a one-time token from the current (device) session and append it to a
// target suite-app URL so the user lands signed in instead of at a login wall.
// Mirrors the other suite apps' handoff helper.
export async function createSuiteHandoffUrl(href: string): Promise<string> {
  try {
    const { token } = await api<{ token: string }>('/api/auth/handoff', { method: 'POST' });
    const url = new URL(href, window.location.origin);
    url.searchParams.set('suite_token', token);
    url.searchParams.set('suite_from', window.location.origin);
    return url.toString();
  } catch {
    // Fall back to the bare URL (the target will prompt for login).
    return href;
  }
}

export function installSuiteHandoff() {
  (globalThis as unknown as { almaCreateSuiteHandoffUrl?: typeof createSuiteHandoffUrl }).almaCreateSuiteHandoffUrl =
    createSuiteHandoffUrl;
}

// Navigate to another suite app, carrying the session via a handoff token.
export async function openSuiteApp(href: string) {
  window.location.assign(await createSuiteHandoffUrl(href));
}
