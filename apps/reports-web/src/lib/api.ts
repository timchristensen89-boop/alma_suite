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

export const STAFF_API_BASE_URL = requiredUrl(['VITE_API_URL', 'VITE_API_BASE_URL'], 'http://localhost:3018');
export const STOCK_API_BASE_URL = requiredUrl(
  ['VITE_STOCK_API_URL', 'VITE_STOCK_API_BASE_URL'],
  'http://localhost:3019'
);
const STAFF_AUTH_TOKEN_KEY = 'alma.reports.staff.session';
const STOCK_AUTH_TOKEN_KEY = 'alma.reports.stock.session';

export function setStaffApiAuthToken(token: string | null | undefined) {
  if (!token) {
    window.localStorage.removeItem(STAFF_AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(STAFF_AUTH_TOKEN_KEY, token);
}

export function setStockApiAuthToken(token: string | null | undefined) {
  if (!token) {
    window.localStorage.removeItem(STOCK_AUTH_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(STOCK_AUTH_TOKEN_KEY, token);
}

export function clearApiAuthTokens() {
  window.localStorage.removeItem(STAFF_AUTH_TOKEN_KEY);
  window.localStorage.removeItem(STOCK_AUTH_TOKEN_KEY);
}

function requestHeaders(label: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const key = label === 'Stock' ? STOCK_AUTH_TOKEN_KEY : STAFF_AUTH_TOKEN_KEY;
  const token = window.localStorage.getItem(key);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

function normalisePath(baseUrl: string, path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (baseUrl.endsWith('/api') && cleanPath.startsWith('/api/')) {
    return cleanPath.slice(4);
  }
  return cleanPath;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(baseUrl: string, label: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${normalisePath(baseUrl, path)}`, {
      credentials: 'include',
      ...init,
      headers: requestHeaders(label, init)
    });
  } catch {
    throw new ApiError(
      `Cannot reach the ALMA ${label} API at ${baseUrl}. Check that the API server is running and the frontend API URL is correct.`,
      0
    );
  }

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ message: 'Request failed' }));
    if (response.status === 401) {
      if (label === 'Stock') setStockApiAuthToken(null);
      else setStaffApiAuthToken(null);
      throw new ApiError('Please sign in again.', response.status);
    }
    throw new ApiError(errorBody.message ?? 'Request failed', response.status);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  if (!body) return undefined as T;
  return JSON.parse(body) as T;
}

export function staffApi<T>(path: string, init?: RequestInit) {
  return request<T>(STAFF_API_BASE_URL, 'Staff', path, init);
}

export function stockApi<T>(path: string, init?: RequestInit) {
  return request<T>(STOCK_API_BASE_URL, 'Stock', path, init);
}
