import type { AuthUser } from '@alma/shared';

function requiredUrl(names: string[], localFallback: string) {
  const value = names.map((name) => import.meta.env[name]).find(Boolean);
  if (import.meta.env.PROD && !value) {
    throw new Error(`${names.join(' or ')} is required for production builds`);
  }
  const url = (value ?? localFallback).replace(/\/+$/, '');
  if (import.meta.env.PROD && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(url)) {
    throw new Error(`${names.join(' or ')} must not point to localhost in production`);
  }
  return url;
}

export const API_BASE_URL = requiredUrl(['VITE_API_URL', 'VITE_API_BASE_URL'], 'http://localhost:3018');
const AUTH_TOKEN_KEY = 'alma.menus.session';

export function setApiAuthToken(token: string | null | undefined) {
  if (!token) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearApiAuthToken() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

function normalisePath(baseUrl: string, path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (baseUrl.endsWith('/api') && cleanPath.startsWith('/api/')) return cleanPath.slice(4);
  return cleanPath;
}

export class ApiError extends Error {
  /**
   * `details` is the server's structured detail, when it sent any — e.g. the
   * validation issues behind a refused publish, or the STALE_DRAFT marker on
   * a save someone else got in ahead of. Absent for a proxy or gateway error.
   */
  constructor(message: string, public readonly status: number, public readonly details: unknown = null) {
    super(message);
  }
}

function unreachableApiError() {
  return new ApiError(
    `Cannot reach the ALMA Menus API at ${API_BASE_URL}. Check that the API server is running and the frontend API URL is correct.`,
    0
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${normalisePath(API_BASE_URL, path)}`, {
      credentials: 'include',
      ...init,
      headers
    });
  } catch {
    throw unreachableApiError();
  }

  if (!response.ok) {
    // A gateway or proxy error has no JSON body: say plainly that nothing was
    // confirmed, rather than a bare "Request failed".
    const body = await response.json().catch(() => ({
      message:
        response.status >= 500
          ? `The server did not answer properly (HTTP ${response.status}). Nothing has been confirmed — reload before trying again.`
          : 'Request failed'
    }));
    if (response.status === 401) setApiAuthToken(null);
    throw new ApiError(body.message ?? 'Request failed', response.status, body.details ?? null);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

/**
 * Fetch a binary endpoint (a published menu PDF) as a Blob.
 *
 * The session is a bearer token in localStorage — auth cookies do not survive
 * cross-site in production — so a plain link or window.open to the API
 * arrives without it and gets a 401. Putting the token in the query string
 * would leak the session into browser history, proxy logs and referrers, so
 * the bytes are fetched with the header and handed to the browser as an
 * object URL instead (lib/menuApi.ts openVersionPdf). No JSON Content-Type: nothing is sent.
 */
export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers();
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${normalisePath(API_BASE_URL, path)}`, {
      credentials: 'include',
      headers
    });
  } catch {
    throw unreachableApiError();
  }

  if (!response.ok) {
    if (response.status === 401) {
      setApiAuthToken(null);
      throw new ApiError('Please sign in again.', 401);
    }
    const body = await response.json().catch(() => ({ message: null }));
    throw new ApiError(body.message ?? 'Could not download that file. Try again.', response.status);
  }
  return response.blob();
}

function urlWithSuiteToken(href: string, token: string) {
  const url = new URL(href, window.location.origin);
  url.searchParams.set('suite_token', token);
  url.searchParams.set('suite_from', window.location.origin);
  return url.toString();
}

export async function createSuiteHandoffUrl(href: string) {
  const data = await api<{ token: string }>('/api/auth/handoff', { method: 'POST' });
  return urlWithSuiteToken(href, data.token);
}

export async function consumeSuiteHandoffToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('suite_token');
  if (!token) return null;
  const data = await api<{ user: AuthUser; token?: string }>('/api/auth/handoff/consume', {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  setApiAuthToken(data.token);
  params.delete('suite_token');
  params.delete('suite_from');
  const nextSearch = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`);
  return data.user;
}

export function installSuiteHandoff() {
  (globalThis as typeof globalThis & {
    almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
  }).almaCreateSuiteHandoffUrl = createSuiteHandoffUrl;
  return () => {
    delete (globalThis as typeof globalThis & {
      almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
    }).almaCreateSuiteHandoffUrl;
  };
}
