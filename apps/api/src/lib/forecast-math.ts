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

// ── Baseline model ───────────────────────────────────────────────────────────
// The heart of the sales forecast, pure so the engine, the backtester and the
// tests all run the exact same arithmetic.

export type BaselineModel = {
  baselineByWeekday: Map<number, number>;
  closedWeekdays: number[];
  trendFactor: number;
};

export type BaselineModelParams = {
  sales: Map<string, number>; // dateKey → cents
  anchor: Date; // sampling runs backwards from here (exclusive)
  firstDataDate: Date | null;
  isHoliday: (dateKey: string) => boolean;
  closedThresholdCents: number;
};

export function buildBaselineModel({ sales, anchor, firstDataDate, isHoliday, closedThresholdCents }: BaselineModelParams): BaselineModel {
  // Trend: last 28 full days vs the 28 before, clamped so one wild month
  // can't swing the whole horizon. Days are compared as weekday-aligned PAIRS
  // (−i vs −i−28); a pair is dropped when either side is a holiday, so a
  // blowout Easter (or a closed Christmas) is neither momentum nor drag.
  let trendFactor = 1;
  if (firstDataDate && firstDataDate <= addDaysUtc(anchor, -56)) {
    let recent = 0;
    let prior = 0;
    for (let i = 1; i <= 28; i += 1) {
      const recentDay = addDaysUtc(anchor, -i);
      const priorDay = addDaysUtc(anchor, -i - 28);
      if (isHoliday(keyOf(recentDay)) || isHoliday(keyOf(priorDay))) continue;
      recent += sales.get(keyOf(recentDay)) ?? 0;
      prior += sales.get(keyOf(priorDay)) ?? 0;
    }
    if (prior > 0 && recent > 0) trendFactor = Math.min(1.15, Math.max(0.85, recent / prior));
  }

  // Per-weekday samples from the trailing 8 weeks, skipping public holidays
  // (holiday trade isn't a normal weekday) and days before data starts.
  const weekdayValues = new Map<number, number[]>();
  for (let weekday = 0; weekday < 7; weekday += 1) weekdayValues.set(weekday, []);
  for (let back = 1; back <= 56; back += 1) {
    const d = addDaysUtc(anchor, -back);
    if (firstDataDate && d < firstDataDate) continue;
    if (isHoliday(keyOf(d))) continue;
    weekdayValues.get(d.getUTCDay())!.push(sales.get(keyOf(d)) ?? 0);
  }

  const closedWeekdays: number[] = [];
  const baselineByWeekday = new Map<number, number>();
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const values = weekdayValues.get(weekday) ?? [];
    if (values.length >= 3 && median(values) < closedThresholdCents) {
      closedWeekdays.push(weekday);
      baselineByWeekday.set(weekday, 0);
    } else {
      baselineByWeekday.set(weekday, trimmedMean(values));
    }
  }

  return { baselineByWeekday, closedWeekdays, trendFactor };
}

// Baseline for one date: weekday baseline blended 70/30 with the same date
// last year — but only when holiday-status matches (an ordinary day last year
// says nothing about this year's Good Friday, and vice versa) — then
// trend-adjusted. Returns the raw last-year figure too, for display.
export function baselineForDate(
  model: BaselineModel,
  sales: Map<string, number>,
  date: Date,
  isHoliday: (dateKey: string) => boolean
): { baselineCents: number; yoyRaw: number | null } {
  const weekday = date.getUTCDay();
  const key = keyOf(date);
  const yoyKey = keyOf(addDaysUtc(date, -364));
  const yoyRaw = sales.get(yoyKey) ?? null;
  const holidayStatusMatches = isHoliday(key) === isHoliday(yoyKey);
  const yoy = holidayStatusMatches ? yoyRaw : null;
  const rawBaseline = model.baselineByWeekday.get(weekday) ?? 0;
  if (model.closedWeekdays.includes(weekday)) return { baselineCents: 0, yoyRaw };
  const blended = yoy != null && yoy > 0 && rawBaseline > 0 ? rawBaseline * 0.7 + yoy * 0.3 : rawBaseline;
  return { baselineCents: Math.round(blended * model.trendFactor), yoyRaw };
}

// ── Cash-flow calendar helpers ───────────────────────────────────────────────

// Standard AU quarters, expressed as the quarter-end month index (0-based).
export function quarterEndMonth(date: Date): number {
  const month = date.getUTCMonth();
  if (month <= 2) return 2;
  if (month <= 5) return 5;
  if (month <= 8) return 8;
  return 11;
}

export function quarterStartOf(date: Date): Date {
  const endMonth = quarterEndMonth(date);
  return new Date(Date.UTC(date.getUTCFullYear(), endMonth - 2, 1));
}

// Next calendar occurrence of {month (0-based), day} strictly at/after `after`.
export function nextOccurrence(due: { month: number; day: number }, after: Date): Date {
  const year = after.getUTCFullYear();
  for (const y of [year, year + 1]) {
    const candidate = new Date(Date.UTC(y, due.month, due.day));
    if (candidate >= after) return candidate;
  }
  return new Date(Date.UTC(year + 1, due.month, due.day));
}
