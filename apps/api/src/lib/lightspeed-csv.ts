/**
 * CSV primitives shared by the emailed-report importers (Lightspeed Insights /
 * Looker exports). Pure: no I/O, no dates read from the clock.
 */

/** RFC-4180-ish: quoted cells, doubled quotes, CRLF or LF, blank rows dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

/** "Sales Data Sale Closed Date" → "sales_data_sale_closed_date". A BOM or stray punctuation falls away. */
export function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Rows keyed by normalised header. Looker sometimes writes a title line above
 * the header ("Site Reconciliations Overview", then a blank line): the header
 * is the first row with at least two non-empty cells, so a one-cell title row
 * is stepped over rather than becoming the only column name.
 */
export function csvObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  let headerIndex = rows.findIndex((row) => row.filter((value) => value.trim()).length >= 2);
  if (headerIndex < 0) headerIndex = 0;
  const headers = rows[headerIndex]?.map(normaliseHeader) ?? [];
  if (headers.length === 0) return [];
  return rows.slice(headerIndex + 1).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      object[header] = row[index]?.trim() ?? '';
    });
    return object;
  });
}

export function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * "$1,234.56" → 123456; "A$12.50" → 1250; "(12.50)" → -1250; "-" or "" → null.
 * Anything that is not a number after the currency dressing is stripped is
 * null, never 0 — a blank cell must not read as "no tips".
 */
export function moneyCents(raw: string | null): number | null {
  if (raw === null) return null;
  let text = raw.trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[^0-9.\-]/g, '');
  if (!text || text === '-' || text === '.') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) * (negative ? -1 : 1);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

/**
 * A date cell → "YYYY-MM-DD", or null when it is not a date.
 *
 * Accepts the shapes these exports actually use: ISO ("2026-09-20", with or
 * without a time), Australian numeric ("20/09/2026", "20-09-2026",
 * "20.09.2026", "20/09/26" — dd/mm first, an unambiguous first segment > 12
 * flips), "2026/09/20", and month names ("20 Sep 2026", "Sun 20 Sep 2026",
 * "Sep 20, 2026"). Anything else falls to the JavaScript parser, read as a
 * local calendar day so a midnight does not slide a day in either direction.
 */
export function parseDateToken(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const iso = (year: number, month: number, day: number) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:\b|$)/);
  if (match) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const year = match[3]!.length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return iso(year, month, day);
  }
  match = value.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (match) {
    const month = MONTHS[match[2]!.slice(0, 3).toLowerCase()];
    if (month) return iso(Number(match[3]), month, Number(match[1]));
  }
  match = value.match(/^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (match) {
    const month = MONTHS[match[1]!.slice(0, 3).toLowerCase()];
    if (month) return iso(Number(match[3]), month, Number(match[2]));
  }
  if (!/\d/.test(value)) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return iso(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}
