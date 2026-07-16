import { apiUrl } from './api';

const AUTH_TOKEN_KEY = 'alma.stock.session';

/**
 * Download a CSV export from the API and trigger a browser save.
 * Centralises the token → fetch → blob → anchor.click() dance that used to be
 * copy-pasted across Items, Stocktake and Recipes. Throws on a non-2xx so the
 * caller can surface the error.
 */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'include'
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
