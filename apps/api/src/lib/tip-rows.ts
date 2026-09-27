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
 * Values that differ are genuine parts and are added up.
 *
 * The opposite trap is a report with one row per SALE (the sales-feed export:
 * SaleID, SaleDate, Tip). Two $10 tips on two different sales are two parts,
 * not one total seen twice — so when rows carry an id, rows with different
 * ids are always parts, and only rows sharing one id (an order listed once
 * per line item, each line repeating the order's tip) collapse to one figure.
 *
 * Getting this wrong either way changes what staff are paid, so it is pure
 * and it is tested.
 */

export type ParsedTipRow = {
  venue: string;
  dateKey: string;
  tipCents: number;
  /**
   * False when the row carried no date of its own and was filed under the
   * email's fallback day. Undated rows are the dangerous ones: several of them
   * land on one key and are added together whether or not they belong to the
   * same trading day. Omitted means dated.
   */
  dated?: boolean;
  /**
   * The sale / transaction / receipt the row belongs to, when the report has
   * such a column. Distinct ids are distinct money. Omitted or null means the
   * report has no row identity, and the repeated-total rule decides.
   */
  rowId?: string | null;
};

export type TipDayTotal = {
  venue: string;
  dateKey: string;
  cents: number;
  rows: number;
  /** True when the rows all carried one repeated day total rather than parts. */
  repeated: boolean;
  /**
   * True when not one row in this day carried a date, so the day itself is the
   * caller's fallback guess. A guessed day holding several differing rows may
   * be several trading days run together, and must not be trusted as one day's
   * takings.
   */
  guessedDate: boolean;
  /** How many distinct sale ids the day's rows carried (0 when the report has none). */
  saleIds: number;
};

type DayBucket = { venue: string; dateKey: string; rows: ParsedTipRow[]; datedRows: number };

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Rows that share an id and an amount are one sale seen per line; otherwise parts. */
function centsForIdentifiedRows(rows: ParsedTipRow[]): { cents: number; saleIds: number } {
  const byId = new Map<string, number[]>();
  let cents = 0;
  for (const row of rows) {
    const id = row.rowId?.trim();
    if (!id) {
      cents += row.tipCents;
      continue;
    }
    const amounts = byId.get(id) ?? [];
    amounts.push(row.tipCents);
    byId.set(id, amounts);
  }
  for (const amounts of byId.values()) {
    cents += new Set(amounts).size === 1 ? amounts[0]! : sum(amounts);
  }
  return { cents, saleIds: byId.size };
}

export function totalTipsPerDay(rows: ParsedTipRow[]): TipDayTotal[] {
  const byDay = new Map<string, DayBucket>();
  for (const row of rows) {
    const key = `${row.venue}|${row.dateKey}`;
    const existing = byDay.get(key) ?? { venue: row.venue, dateKey: row.dateKey, rows: [], datedRows: 0 };
    existing.rows.push(row);
    if (row.dated !== false) existing.datedRows += 1;
    byDay.set(key, existing);
  }

  return Array.from(byDay.values()).map(({ venue, dateKey, rows: dayRows, datedRows }) => {
    const values = dayRows.map((row) => row.tipCents);
    const distinct = new Set(values);
    const identified = dayRows.some((row) => row.rowId?.trim());
    if (identified) {
      const { cents, saleIds } = centsForIdentifiedRows(dayRows);
      // One sale listed on several lines, each carrying the same tip: that is
      // the repeated shape again, just scoped to a sale rather than a day.
      const allSameId = new Set(dayRows.map((row) => row.rowId?.trim() || '')).size === 1;
      const repeated = allSameId && values.length > 1 && distinct.size === 1 && values[0]! > 0;
      return { venue, dateKey, cents, rows: values.length, repeated, guessedDate: datedRows === 0, saleIds };
    }
    // One value, seen more than once, and it is real money: a repeated total.
    // Zeroes are exempt — a day of all-zero rows is genuinely zero either way,
    // and treating it as "repeated" would say something misleading in the log.
    const repeated = values.length > 1 && distinct.size === 1 && values[0]! > 0;
    return {
      venue,
      dateKey,
      cents: repeated ? values[0]! : sum(values),
      rows: values.length,
      repeated,
      guessedDate: datedRows === 0,
      saleIds: 0
    };
  });
}
