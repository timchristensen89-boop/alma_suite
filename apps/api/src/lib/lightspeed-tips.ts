/**
 * Reading card tips out of an emailed Lightspeed (Kounta) Insights report.
 *
 * Plan B for tip pooling while the Lightspeed API stays a paid add-on: any
 * scheduled report whose CSV carries a tips/gratuity column feeds the same
 * StaffTipCardEntry rows the Square import writes. Everything here is pure —
 * the service supplies the fallback venue and day, the clock, and the
 * database — so the column rules can be tested against the shapes these
 * reports have actually arrived in:
 *
 *   - Looker prefixes the view name and suffixes the timeframe, so the date
 *     column is "Sales Data Sale Closed Date", "Sale Closed Date Date" or
 *     "Payments Payment Date", not "date". A fixed list of names missed all
 *     of those, every row read as undated, and the importer refused the day.
 *   - The date and the money often land on SEPARATE rows (a date-only row,
 *     then a values row with a blank date), so the last seen date carries
 *     forward within a file.
 *   - The sales-feed export is one row per sale (SaleID, SaleDate, Tip). Two
 *     sales tipping the same amount are two tips, so rows carry their sale id
 *     through to the per-day totaller, which never collapses distinct ids.
 *   - Rate / percentage / count columns are never money.
 */
import { csvObjects, moneyCents, normaliseHeader, parseCsv, parseDateToken } from './lightspeed-csv.js';
import type { TipDayTotal } from './tip-rows.js';

export type TipsCsvRow = {
  venueRaw: string | null;
  /** The row's own date, or null when it had none (the caller supplies the day). */
  dateKey: string | null;
  tipCents: number;
  /** The sale / transaction the row belongs to, when the report identifies one. */
  rowId: string | null;
};

export type TipsCsvParse = {
  rows: TipsCsvRow[];
  sawTipsColumn: boolean;
  columns: { tip: string | null; date: string | null; id: string | null; venue: string | null };
};

const TIP_COLUMN = /(^|_)tips?($|_)|gratuit/;
const NOT_MONEY = /rate|percent|pct|(^|_)count($|_)|(^|_)qty($|_)|number_of|no_of|(^|_)num($|_)/;

/** The one tips column. Summing "total_tips" and "card_tips" together would double-count, so the most total-looking column wins. */
export function findTipColumn(headers: string[]): string | null {
  const candidates = headers.filter((header) => TIP_COLUMN.test(header) && !NOT_MONEY.test(header));
  if (candidates.length === 0) return null;
  return candidates.find((header) => /total/.test(header)) ?? candidates[0]!;
}

// Not a date however the header reads: week/month/year buckets, day-of-week
// labels, "days open", dayparts, and anything that is a rate or an update stamp.
const NOT_A_DATE = /week|month|year|quarter|day_of|dow|daypart|day_part|weekday|days_|_days($|_)|update|rate|opening|closing_time|time_zone|timezone/;
const DATE_PREFERENCE: RegExp[] = [
  /(^|_)(sale|sales|business|trading|service|transaction|payment|order|closed|receipt)_?(closed_)?date($|_)/,
  /(^|_)date($|_)/,
  /date/,
  /(^|_)(sale|sales|closed|transaction|payment|order|receipt)_?(closed_)?(time|datetime|timestamp)($|_)/,
  /(^|_)(trading|business|service)_day($|_)/,
  /^day$/,
  /(^|_)(created|timestamp|datetime)($|_)/
];

/**
 * The column that dates each row. Candidates are tried in preference order and
 * a candidate counts only if at least one of its non-empty cells parses as a
 * date — so a "Date" header over a column of labels does not win by name.
 */
export function findDateColumn(headers: string[], rows: Array<Record<string, string>>): string | null {
  const usable = headers.filter((header) => !NOT_A_DATE.test(header));
  for (const pattern of DATE_PREFERENCE) {
    for (const header of usable) {
      if (!pattern.test(header)) continue;
      const parses = rows.some((row) => {
        const value = row[header]?.trim();
        return Boolean(value) && parseDateToken(value!) !== null;
      });
      if (parses) return header;
    }
  }
  return null;
}

const ROW_ID_COLUMN =
  /(^|_)(sale|sales|transaction|txn|receipt|order|payment|invoice|docket|check|ticket)s?_?(id|number|no|num|ref|reference)($|_)|^id$/;

/** The column that says which sale a row belongs to, if the report has one. */
export function findRowIdColumn(headers: string[]): string | null {
  return headers.find((header) => ROW_ID_COLUMN.test(header)) ?? null;
}

const VENUE_COLUMN = /(^|_)(site|venue|location|store|outlet)(_?name)?($|_)/;

export function findVenueColumn(headers: string[]): string | null {
  return headers.find((header) => VENUE_COLUMN.test(header) && !/_id($|_)/.test(header)) ?? null;
}

export function parseTipsFromCsv(csv: string): TipsCsvParse {
  const objects = csvObjects(csv);
  const empty = { rows: [], sawTipsColumn: false, columns: { tip: null, date: null, id: null, venue: null } };
  if (objects.length === 0) return empty;
  const headers = Object.keys(objects[0] ?? {});
  const tipColumn = findTipColumn(headers);
  if (!tipColumn) return empty;
  const dateColumn = findDateColumn(headers, objects);
  const idColumn = findRowIdColumn(headers);
  const venueColumn = findVenueColumn(headers);

  let carriedDate: string | null = null;
  const rows: TipsCsvRow[] = [];
  for (const row of objects) {
    const dateRaw = dateColumn ? row[dateColumn]?.trim() : '';
    const dateKey = dateRaw ? parseDateToken(dateRaw) : null;
    if (dateKey) carriedDate = dateKey;
    const cents = moneyCents(row[tipColumn] ?? null);
    if (cents === null) continue;
    rows.push({
      venueRaw: venueColumn ? row[venueColumn]?.trim() || null : null,
      dateKey: dateKey ?? carriedDate,
      tipCents: Math.max(0, cents),
      rowId: idColumn ? row[idColumn]?.trim() || null : null
    });
  }
  return { rows, sawTipsColumn: true, columns: { tip: tipColumn, date: dateColumn, id: idColumn, venue: venueColumn } };
}

/** Whether a CSV has a header row at all — used to describe attachments in warnings. */
export function csvHeaders(csv: string): string[] {
  return parseCsv(csv)[0]?.map(normaliseHeader) ?? [];
}

// ── Which attachments to read ────────────────────────────────────────────────
// Looker "overview" dashboards attach every tile as its own CSV. Rankings and
// movers (top 10, highest, drop-off, discounts) are partial by construction
// and must feed neither item sales nor tips. "Untitled", "Summary of …" and
// "Total …" tiles are whole-dashboard summaries: too coarse for the item mix,
// but a tips column on one of them is the day's tips — skipping those tiles
// by name is how a tips report that parsed cleanly recorded nothing.
const RANKING_FRAGMENT = /top_|highest_|drop-?off|discount/i;
const SUMMARY_TILE = /untitled|total_products_sold|total_revenue_last_week|summary_of_/i;

export function isRankingFragment(filename: string): boolean {
  return RANKING_FRAGMENT.test(filename);
}

/** A tile that must not feed item sales or day totals (rankings AND summary tiles). */
export function isDigestFragment(filename: string): boolean {
  return RANKING_FRAGMENT.test(filename) || SUMMARY_TILE.test(filename);
}

// ── Merging across attachments ───────────────────────────────────────────────
export type AttachmentTipDays = { filename: string; days: TipDayTotal[] };

export type MergedTipDay = TipDayTotal & { files: string[] };

export type DisputedTipDay = {
  venue: string;
  dateKey: string;
  figures: Array<{ filename: string; cents: number; rows: number }>;
};

/**
 * One figure per venue-day across every attachment in the email. Attachments
 * are totalled separately first: pooling their rows would add one tile's day
 * total to another's. Where two tiles agree, that is the figure; where they
 * disagree, nothing is recorded for the day and the caller says so — a gap
 * with a warning is recoverable, a plausible wrong number gets paid out.
 */
export function mergeAttachmentTips(perAttachment: AttachmentTipDays[]): { days: MergedTipDay[]; disputed: DisputedTipDay[] } {
  const byKey = new Map<string, Array<{ filename: string; day: TipDayTotal }>>();
  for (const attachment of perAttachment) {
    for (const day of attachment.days) {
      const key = `${day.venue}|${day.dateKey}`;
      const list = byKey.get(key) ?? [];
      list.push({ filename: attachment.filename, day });
      byKey.set(key, list);
    }
  }
  const days: MergedTipDay[] = [];
  const disputed: DisputedTipDay[] = [];
  for (const entries of byKey.values()) {
    const distinct = new Set(entries.map((entry) => entry.day.cents));
    if (distinct.size > 1) {
      disputed.push({
        venue: entries[0]!.day.venue,
        dateKey: entries[0]!.day.dateKey,
        figures: entries.map((entry) => ({ filename: entry.filename, cents: entry.day.cents, rows: entry.day.rows }))
      });
      continue;
    }
    // Agreeing tiles: the best-evidenced one describes the day (a dated one
    // over a guessed one, then the one that read more rows).
    const [best] = [...entries].sort(
      (a, b) => Number(a.day.guessedDate) - Number(b.day.guessedDate) || b.day.rows - a.day.rows
    );
    days.push({ ...best!.day, files: entries.map((entry) => entry.filename) });
  }
  return { days, disputed };
}
