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
const AUTH_TOKEN_KEY = 'alma.marketing.session';

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
  constructor(message: string, public readonly status: number) {
    super(message);
  }
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
    throw new ApiError(
      `Cannot reach the ALMA Marketing API at ${API_BASE_URL}. Check that the API server is running and the frontend API URL is correct.`,
      0
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'Request failed' }));
    if (response.status === 401) setApiAuthToken(null);
    throw new ApiError(body.message ?? 'Request failed', response.status);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}
