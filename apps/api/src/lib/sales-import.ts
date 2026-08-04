// Manual and CSV sales entry for the live forecast.
//
// Context: Square is disconnected and the Lightspeed API is not being paid for,
// so hand-entered and uploaded sales are now the PRIMARY feed for the forecast,
// not a fallback. That raises the stakes on two things:
//
//   1. GST basis. `SalesActualEntry.salesCents` is GST EXCLUSIVE ("net sales
//      ex GST"). A venue reading gross takings off the till is holding a
//      GST-INCLUSIVE number. Storing that unconverted overstates sales by 10%
//      and drags every downstream figure — COGS %, labour %, prime cost — with
//      it. So the basis is a required, explicit input. It is never guessed.
//   2. Forgiveness. This is typed by a manager at the end of service, often on
//      a phone. Column names, date formats and currency symbols vary, so the
//      parser accepts what people actually produce.

import { dollarsToCents, parseCsv, parseImportDate } from './forecast/import-validate.js';

/** GST basis of the amount being entered. Required — never inferred. */
export type GstBasis = 'INCLUSIVE' | 'EXCLUSIVE';

const GST_DIVISOR = 1.1;

/** Convert a typed amount to the GST-exclusive figure the forecast stores. */
export function toExGstCents(amountCents: number, basis: GstBasis): number {
  return basis === 'INCLUSIVE' ? Math.round(amountCents / GST_DIVISOR) : amountCents;
}

/** Column aliases people actually use, mapped to what we need. */
const DATE_COLUMNS = ['date', 'business_date', 'service_date', 'serviceDate', 'trading_date', 'day'];
const VENUE_COLUMNS = ['venue', 'venue_code', 'venue_name', 'site', 'location'];
const INC_GST_COLUMNS = ['gross_sales_inc_gst', 'gross_sales', 'gross', 'takings', 'total_sales', 'sales_inc_gst'];
const EX_GST_COLUMNS = ['net_sales_ex_gst', 'net_sales', 'sales_ex_gst', 'net'];
const AMBIGUOUS_COLUMNS = ['sales', 'amount', 'value'];
const NOTES_COLUMNS = ['notes', 'note', 'comment', 'comments'];

/** Spreadsheets write "Business Date"; templates write "business_date". Match
 *  on letters and digits only so both, and "BusinessDate", all resolve. */
const columnKey = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function pick(row: Record<string, string>, names: string[]): { column: string; value: string } | null {
  const lowerKeys = new Map(Object.keys(row).map((key) => [columnKey(key), key]));
  for (const name of names) {
    const actual = lowerKeys.get(columnKey(name));
    if (actual !== undefined) {
      const value = (row[actual] ?? '').trim();
      if (value !== '') return { column: actual, value };
    }
  }
  return null;
}

/** Map a free-text venue to a configured venue name. */
export function resolveVenue(raw: string, venues: string[]): string | null {
  const needle = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!needle) return null;
  const exact = venues.find((venue) => venue.toLowerCase().replace(/[^a-z0-9]/g, '') === needle);
  if (exact) return exact;
  // Codes and shorthand people actually type.
  const aliases: Record<string, string[]> = {
    avalon: ['almaavalon', 'avalon', 'tcc', 'twocookedchooks'],
    freshwater: ['stalma', 'freshwater', 'af', 'almafreshwater']
  };
  for (const venue of venues) {
    const key = venue.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [, list] of Object.entries(aliases)) {
      if (list.includes(needle) && list.includes(key)) return venue;
    }
  }
  const contained = venues.find((venue) => {
    const key = venue.toLowerCase().replace(/[^a-z0-9]/g, '');
    return key.includes(needle) || needle.includes(key);
  });
  return contained ?? null;
}

export interface SalesImportRow {
  rowNumber: number;
  venue: string;
  serviceDate: Date;
  /** Always GST exclusive by the time it leaves here. */
  salesCents: number;
  /** What was typed, so the preview can show the conversion honestly. */
  enteredCents: number;
  enteredBasis: GstBasis;
  notes: string | null;
}

export interface SalesImportError {
  rowNumber: number;
  column: string | null;
  message: string;
}

export interface SalesImportResult {
  rows: SalesImportRow[];
  errors: SalesImportError[];
  /** Rows whose venue+date already appeared earlier in the file. */
  duplicateRowNumbers: number[];
  /** True when the file itself told us the basis per column. */
  basisFromFile: boolean;
  totalRows: number;
}

export interface ParseOptions {
  /** Basis for amounts whose column does not state one. Required. */
  defaultBasis: GstBasis;
  /** Configured venue names, for resolution and validation. */
  venues: string[];
  /** Used when a row omits the venue. */
  defaultVenue?: string | null;
}

/**
 * Parse a sales CSV into rows ready for the existing idempotent upsert.
 *
 * A column explicitly named ex-GST or inc-GST wins over `defaultBasis` — the
 * file knows better than the dropdown when it says so.
 */
export function parseSalesCsv(csvText: string, options: ParseOptions): SalesImportResult {
  const raw = parseCsv(csvText);
  const rows: SalesImportRow[] = [];
  const errors: SalesImportError[] = [];
  const duplicateRowNumbers: number[] = [];
  const seen = new Map<string, number>();
  let basisFromFile = false;

  raw.forEach((record, index) => {
    // Row 1 is the header, so data starts at 2 — matching the spreadsheet.
    const rowNumber = index + 2;

    const dateCell = pick(record, DATE_COLUMNS);
    if (!dateCell) {
      errors.push({ rowNumber, column: 'date', message: 'No date column found. Expected one of: date, business_date, service_date.' });
      return;
    }
    const serviceDate = parseImportDate(dateCell.value);
    if (!serviceDate) {
      errors.push({ rowNumber, column: dateCell.column, message: `"${dateCell.value}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY.` });
      return;
    }

    const venueCell = pick(record, VENUE_COLUMNS);
    const venueRaw = venueCell?.value ?? options.defaultVenue ?? '';
    if (!venueRaw) {
      errors.push({ rowNumber, column: 'venue', message: 'No venue in the row and no venue selected for the upload.' });
      return;
    }
    const venue = resolveVenue(venueRaw, options.venues);
    if (!venue) {
      errors.push({ rowNumber, column: venueCell?.column ?? 'venue', message: `"${venueRaw}" does not match a configured venue (${options.venues.join(', ')}).` });
      return;
    }

    // A column that names its basis wins over the dropdown.
    let basis: GstBasis = options.defaultBasis;
    let amountCell = pick(record, EX_GST_COLUMNS);
    if (amountCell) { basis = 'EXCLUSIVE'; basisFromFile = true; }
    if (!amountCell) {
      amountCell = pick(record, INC_GST_COLUMNS);
      if (amountCell) { basis = 'INCLUSIVE'; basisFromFile = true; }
    }
    if (!amountCell) amountCell = pick(record, AMBIGUOUS_COLUMNS);

    if (!amountCell) {
      errors.push({ rowNumber, column: 'sales', message: 'No sales amount found. Expected a sales, gross_sales_inc_gst or net_sales_ex_gst column.' });
      return;
    }

    const enteredCents = dollarsToCents(amountCell.value);
    if (enteredCents === null) {
      errors.push({ rowNumber, column: amountCell.column, message: `"${amountCell.value}" is not an amount.` });
      return;
    }
    if (enteredCents < 0) {
      errors.push({ rowNumber, column: amountCell.column, message: 'Sales cannot be negative. Record refunds separately rather than as negative takings.' });
      return;
    }

    const key = `${venue}|${serviceDate.toISOString().slice(0, 10)}`;
    const firstSeen = seen.get(key);
    if (firstSeen !== undefined) {
      duplicateRowNumbers.push(rowNumber);
      errors.push({ rowNumber, column: null, message: `Duplicate of row ${firstSeen} — same venue and date. Skipped so it is not counted twice.` });
      return;
    }
    seen.set(key, rowNumber);

    rows.push({
      rowNumber,
      venue,
      serviceDate,
      salesCents: toExGstCents(enteredCents, basis),
      enteredCents,
      enteredBasis: basis,
      notes: pick(record, NOTES_COLUMNS)?.value ?? null
    });
  });

  return { rows, errors, duplicateRowNumbers, basisFromFile, totalRows: raw.length };
}

/** Downloadable error report so a failed upload is actionable. */
export function buildSalesErrorCsv(errors: SalesImportError[]): string {
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return ['row,column,message', ...errors.map((error) => [String(error.rowNumber), error.column ?? '', escape(error.message)].join(','))].join('\n') + '\n';
}

/** The template a venue downloads. Deliberately tiny — four columns. */
export function salesTemplateCsv(): string {
  return [
    'date,venue,gross_sales_inc_gst,notes',
    '2026-08-01,Alma Avalon,4210.55,Friday service',
    '2026-08-02,St Alma,3980.10,',
    ''
  ].join('\n');
}
