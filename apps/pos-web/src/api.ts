// Thin fetch wrapper for the venue iPad ops console.
//
// Matches the home-web pattern: relative paths via the Vite `/api` proxy in
// dev (forwarded to apps/api on :3018) and same-origin in production. Cookies
// are sent on every request so the venue device session + staff PIN session
// follow the user without manual token handling.

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');

// Safari (iPads!) blocks cross-site cookies, and the API lives on its own
// domain — so sessions ALSO travel as tokens, like the other suite apps.
const TOKEN_KEY = 'alma.pos.authToken';
const PIN_TOKEN_KEY = 'alma.pos.pinToken';
let authToken: string | null = localStorage.getItem(TOKEN_KEY);
let pinToken: string | null = localStorage.getItem(PIN_TOKEN_KEY);

export function setApiAuthToken(token?: string | null) {
  if (!token) return;
  authToken = token;
  localStorage.setItem(TOKEN_KEY, token);
}

export function setApiPinToken(token?: string | null) {
  if (token) {
    pinToken = token;
    localStorage.setItem(PIN_TOKEN_KEY, token);
  } else {
    pinToken = null;
    localStorage.removeItem(PIN_TOKEN_KEY);
  }
}

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
  if (authToken && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${authToken}`);
  if (pinToken && !headers.has('x-device-pin-session')) headers.set('x-device-pin-session', pinToken);

  // A register must never hang on a wedged connection (e.g. an API restart
  // leaving a dead HTTP/2 stream): 15s hard timeout, surfaced as a network
  // error so the offline machinery takes over where it applies.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${normalisePath(path)}`, {
      credentials: 'include',
      ...init,
      headers,
      signal: controller.signal
    });
  } catch (err) {
    if (controller.signal.aborted) throw new TypeError('Network timeout — the register could not reach the server.');
    throw err;
  } finally {
    clearTimeout(timer);
  }

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

// Arriving FROM Alma Home: redeem the one-time token in the URL for a
// session cookie, then scrub it from the address bar.
export async function consumeSuiteHandoffToken(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('suite_token');
  if (!token) return false;
  let ok = true;
  try {
    const data = await api<{ token?: string }>('/api/auth/handoff/consume', { method: 'POST', body: JSON.stringify({ token }) });
    setApiAuthToken(data.token);
  } catch {
    ok = false;
  }
  params.delete('suite_token');
  params.delete('suite_from');
  const nextSearch = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`);
  return ok;
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
