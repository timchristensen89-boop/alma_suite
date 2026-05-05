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

const API_BASE_URL = requiredUrl(['VITE_API_URL', 'VITE_API_BASE_URL'], 'http://localhost:3018');
const AUTH_TOKEN_KEY = 'alma.staff.session';

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

function requestHeaders(init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function normalisePath(path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (API_BASE_URL.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return cleanPath.slice(4);
  }
  return cleanPath;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${normalisePath(path)}`, {
      credentials: 'include',
      ...init,
      headers: requestHeaders(init)
    });
  } catch {
    throw new ApiError(
      `Cannot reach the ALMA Staff API at ${API_BASE_URL}. Check that the API server is running and the frontend API URL is correct.`,
      0
    );
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Request failed' }));
    if (response.status === 401) {
      clearApiAuthToken();
      throw new ApiError('Please sign in again.', response.status);
    }
    throw new ApiError(errorBody.message ?? 'Request failed', response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.text();
  if (!body) {
    return undefined as T;
  }

  return JSON.parse(body) as T;
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
