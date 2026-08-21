/**
 * Turning the tip cells of an emailed report into one figure per venue per day.
 *
 * The trap this exists to avoid: a scheduled Lightspeed report is rarely one
 * row per day. It is split by revenue centre, payment type or site, and the
 * tips column on those rows is very often the **day's total repeated on every
 * row** rather than that row's own share. Summing it then multiplies the day's
 * tips by the number of rows — which is exactly what happened to Alma Avalon
 * for the week of 17 August 2026, where every day came out at 3× the money
 * that was actually in the till.
 *
 * So: identical values repeated across a day are one total seen several times.
 * Values that differ are genuine parts and are added up. Getting this wrong
 * either way changes what staff are paid, so it is pure and it is tested.
 */

export type ParsedTipRow = {
  venue: string;
  dateKey: string;
  tipCents: number;
};

export type TipDayTotal = {
  venue: string;
  dateKey: string;
  cents: number;
  rows: number;
  /** True when the rows all carried one repeated day total rather than parts. */
  repeated: boolean;
};

export function totalTipsPerDay(rows: ParsedTipRow[]): TipDayTotal[] {
  const byDay = new Map<string, { venue: string; dateKey: string; values: number[] }>();
  for (const row of rows) {
    const key = `${row.venue}|${row.dateKey}`;
    const existing = byDay.get(key) ?? { venue: row.venue, dateKey: row.dateKey, values: [] };
    existing.values.push(row.tipCents);
    byDay.set(key, existing);
  }

  return Array.from(byDay.values()).map(({ venue, dateKey, values }) => {
    const distinct = new Set(values);
    // One value, seen more than once, and it is real money: a repeated total.
    // Zeroes are exempt — a day of all-zero rows is genuinely zero either way,
    // and treating it as "repeated" would say something misleading in the log.
    const repeated = values.length > 1 && distinct.size === 1 && values[0]! > 0;
    return {
      venue,
      dateKey,
      cents: repeated ? values[0]! : values.reduce((sum, value) => sum + value, 0),
      rows: values.length,
      repeated
    };
  });
}
