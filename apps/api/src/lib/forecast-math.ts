// Pure date/statistics helpers for the forecast engine — no I/O, no Prisma,
// covered by forecast-math.test.ts (run with `pnpm --filter @alma/api test`).
//
// Service-date convention: a "date key" is the Sydney calendar date as
// YYYY-MM-DD, stored/compared as UTC midnight of that key (matches the Square
// sync, SevenRooms ingestion and timesheets).

export const DAY_MS = 86_400_000;

const sydneyDayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' });

export function sydneyTodayKey(): string {
  return sydneyDayFormatter.format(new Date());
}

export function sydneyKeyForInstant(instant: Date): string {
  return sydneyDayFormatter.format(instant);
}

export function dateFromKey(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// UTC-midnight Monday of the week containing `date` (weeks run Mon-Sun).
export function mondayOf(date: Date): Date {
  const weekday = date.getUTCDay();
  return addDaysUtc(date, weekday === 0 ? -6 : 1 - weekday);
}

// Mean with the single highest and lowest values dropped once there are at
// least 5 samples — one bomb night or one closure can't swing the baseline.
export function trimmedMean(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trimmed = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  return trimmed.reduce((sum, v) => sum + v, 0) / trimmed.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : sorted[mid] ?? 0;
}

export function pctOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}
