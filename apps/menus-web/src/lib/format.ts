import type { MenuActor } from '@alma/shared';

export function personName(actor: MenuActor | null | undefined): string {
  return actor?.name?.trim() || 'someone';
}

/** "today 14:05", "yesterday 09:12", "3 Oct, 18:40" — Sydney time, the venues' clock. */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const timeZone = 'Australia/Sydney';
  const time = new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(date);
  const dayKey = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(today)) return `today ${time}`;
  if (dayKey(date) === dayKey(yesterday)) return `yesterday ${time}`;
  const day = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', timeZone, ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
  return `${day}, ${time}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date(iso));
}

export function pdfFilename(menu: { venue: { slug: string }; name: string }, versionNumber: number): string {
  return `${menu.venue.slug}-${menu.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') + `-v${versionNumber}.pdf`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
